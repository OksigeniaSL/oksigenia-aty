// Adds the notification service extension (resources/ios/NotificationService) to the Xcode project that cordova makes,
// after every prepare: the target NotificationService (<app id>.NotificationService), its sources, Info.plist,
// entitlements and build settings, and the "Embed App Extensions" phase of the app. Cordova has no way to declare an app
// extension, and the project is made anew on every build in the CI, so the hook is idempotent: what is there already is
// updated, not added twice.
//
// The extension carries the version and the build number of the app (App Store Connect wants them equal), and for a
// signed release the profile that build.json maps to its bundle id under ios.release.provisioningProfile.
//
// Its build settings live in NotificationService.xcconfig, not in the project: cordova takes the app's Info.plist from
// the first build configuration of the project that names one, and the app's bundle id from the last one
// (cordova-ios/lib/projectFile.js), so the extension's must name neither.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const NAME = 'NotificationService';
const SOURCE_DIR = path.join('resources', 'ios', NAME);
const SOURCES = ['NotificationService.swift', 'AtyNotice.swift', 'AtyKeychain.swift', 'AtySealedBox.c'];
const HEADERS = ['AtySealedBox.h', 'NotificationService-Bridging-Header.h'];
const INFO_PLIST = 'Info.plist';
const ENTITLEMENTS = `${NAME}.entitlements`;
const XCCONFIG = `${NAME}.xcconfig`;
const PRODUCT = `${NAME}.appex`;
const EMBED_PHASE = 'Embed App Extensions';
const FILE_TYPES = {
    '.swift': 'sourcecode.swift',
    '.c': 'sourcecode.c.c',
    '.h': 'sourcecode.c.h',
    '.plist': 'text.plist.xml',
    '.entitlements': 'text.plist.entitlements',
    '.xcconfig': 'text.xcconfig',
};

/** A value as the project file writes it: quoted unless it is a plain word or path. */
function quote(value) {
    const text = String(value);
    return /^[A-Za-z0-9_./]+$/.test(text) ? text : `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function unquote(value) {
    return typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value;
}

function section(objects, isa) {
    if (!objects[isa]) {
        objects[isa] = {};
    }
    return objects[isa];
}

function items(sectionObject) {
    return Object.keys(sectionObject).filter((key) => !key.endsWith('_comment')).map((key) => [key, sectionObject[key]]);
}

/** Adds an object under an id made from its key, the same on every build. */
function add(project, isa, object, comment, key) {
    const objects = project.hash.project.objects;
    let uuid = crypto.createHash('sha1').update(`${NAME}:${key}`).digest('hex').slice(0, 24).toUpperCase();
    while (Object.values(objects).some((sectionObject) => sectionObject && sectionObject[uuid])) {
        uuid = project.generateUuid();
    }
    section(objects, isa)[uuid] = Object.assign({ isa }, object);
    if (comment) {
        section(objects, isa)[`${uuid}_comment`] = comment;
    }
    return uuid;
}

function requireFromCordovaIos(projectRoot, name) {
    return require(require.resolve(name, { paths: [path.join(projectRoot, 'node_modules', 'cordova-ios'), projectRoot] }));
}

/** The provisioning profile of the extension for a signed release, from build.json, or null. */
function releaseSigning(context, projectRoot, bundleId) {
    const options = (context.opts && context.opts.options) || {};
    const file = options.buildConfig ? path.resolve(options.buildConfig) : path.join(projectRoot, 'build.json');
    if (!fs.existsSync(file)) {
        return null;
    }
    const release = ((JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).ios) || {}).release || {};
    const profiles = release.provisioningProfile;
    const profile = profiles && typeof profiles === 'object' ? profiles[bundleId] : undefined;
    if (!profile) {
        return null;
    }
    return { profile: String(profile), team: release.developmentTeam, identity: release.codeSignIdentity };
}

function writeIfChanged(file, content) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
        fs.writeFileSync(file, content, 'utf8');
    }
}

/** The build settings of the extension, with the app's deployment target and device family, and its signing. */
function xcconfig(bundleId, appSettings, signing) {
    const lines = [
        '// The build settings of the notification service extension, written by',
        '// scripts/cordova-hooks/ios-notification-service.js on every prepare.',
        'APPLICATION_EXTENSION_API_ONLY = YES',
        'CLANG_ENABLE_MODULES = YES',
        `CODE_SIGN_ENTITLEMENTS = ${NAME}/${ENTITLEMENTS}`,
        'GENERATE_INFOPLIST_FILE = NO',
        `INFOPLIST_FILE = ${NAME}/${INFO_PLIST}`,
        `IPHONEOS_DEPLOYMENT_TARGET = ${unquote(appSettings.IPHONEOS_DEPLOYMENT_TARGET) || '15.0'}`,
        'LD_RUNPATH_SEARCH_PATHS = $(inherited) @executable_path/Frameworks @executable_path/../../Frameworks',
        `PRODUCT_BUNDLE_IDENTIFIER = ${bundleId}`,
        'PRODUCT_NAME = $(TARGET_NAME)',
        'SKIP_INSTALL = YES',
        'SUPPORTS_MACCATALYST = NO',
        '// The project-wide bridging header is the app\'s, with Cordova in it.',
        `SWIFT_OBJC_BRIDGING_HEADER = ${NAME}/${NAME}-Bridging-Header.h`,
        'SWIFT_VERSION = 5.0',
        `TARGETED_DEVICE_FAMILY = ${unquote(appSettings.TARGETED_DEVICE_FAMILY) || '1,2'}`,
        'GCC_OPTIMIZATION_LEVEL[config=Debug] = 0',
        'SWIFT_OPTIMIZATION_LEVEL[config=Debug] = -Onone',
        'SWIFT_ACTIVE_COMPILATION_CONDITIONS[config=Debug] = DEBUG',
        'GCC_OPTIMIZATION_LEVEL[config=Release] = s',
        'SWIFT_OPTIMIZATION_LEVEL[config=Release] = -O',
    ];
    if (signing) {
        lines.push('// Signed for the App Store with its own profile (build.json).');
        lines.push('CODE_SIGN_STYLE[config=Release] = Manual');
        lines.push(`PROVISIONING_PROFILE_SPECIFIER[config=Release] = ${signing.profile}`);
        if (signing.team) {
            lines.push(`DEVELOPMENT_TEAM[config=Release] = ${signing.team}`);
        }
        if (signing.identity) {
            lines.push(`CODE_SIGN_IDENTITY[config=Release] = ${signing.identity}`);
            lines.push(`CODE_SIGN_IDENTITY[config=Release][sdk=iphoneos*] = ${signing.identity}`);
        }
    }
    return `${lines.join('\n')}\n`;
}

/** Copies the sources and writes Info.plist, the entitlements and the build settings of the extension. */
function writeExtensionFiles(projectRoot, iosRoot, appInfo, appId, projectName, settings) {
    const plist = requireFromCordovaIos(projectRoot, 'plist');
    const dir = path.join(iosRoot, NAME);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of SOURCES.concat(HEADERS)) {
        writeIfChanged(path.join(dir, file), fs.readFileSync(path.join(projectRoot, SOURCE_DIR, file), 'utf8'));
    }

    writeIfChanged(path.join(dir, INFO_PLIST), plist.build({
        CFBundleDevelopmentRegion: appInfo.CFBundleDevelopmentRegion || 'en',
        CFBundleDisplayName: NAME,
        CFBundleExecutable: '$(EXECUTABLE_NAME)',
        CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
        CFBundleInfoDictionaryVersion: '6.0',
        CFBundleName: '$(PRODUCT_NAME)',
        CFBundlePackageType: 'XPC!',
        CFBundleShortVersionString: appInfo.CFBundleShortVersionString,
        CFBundleVersion: appInfo.CFBundleVersion,
        // Where AtyKeychain.swift finds the app's bundle name if it cannot read the app's Info.plist.
        AtyHostBundleName: projectName,
        NSExtension: {
            NSExtensionPointIdentifier: 'com.apple.usernotifications.service',
            NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).NotificationService',
        },
    }));

    // The app's default keychain access group is its App ID; the push plugin keeps its key there, without naming a group.
    writeIfChanged(path.join(dir, ENTITLEMENTS), plist.build({
        'keychain-access-groups': [`$(AppIdentifierPrefix)${appId}`],
    }));

    writeIfChanged(path.join(dir, XCCONFIG), settings);
}

function findTarget(objects, name) {
    return items(section(objects, 'PBXNativeTarget')).find(([, target]) => unquote(target.name) === name) || [];
}

function buildConfigurations(objects, listUuid) {
    const list = section(objects, 'XCConfigurationList')[listUuid];
    const configs = section(objects, 'XCBuildConfiguration');
    return (list ? list.buildConfigurations : []).map((ref) => [ref.value, configs[ref.value]]);
}

/** The group of the extension's files, under the main group. */
function ensureGroup(project) {
    const objects = project.hash.project.objects;
    const groups = section(objects, 'PBXGroup');
    const found = items(groups).find(([, group]) => unquote(group.path) === NAME);
    if (found) {
        return found[0];
    }
    const uuid = add(project, 'PBXGroup', { children: [], path: NAME, sourceTree: '"<group>"' }, NAME, 'group');
    groups[project.getFirstProject().firstProject.mainGroup].children.push({ value: uuid, comment: NAME });
    return uuid;
}

function ensureFileReference(project, groupUuid, file) {
    const group = section(project.hash.project.objects, 'PBXGroup')[groupUuid];
    const found = group.children.find((child) => child.comment === file);
    if (found) {
        return found.value;
    }
    const uuid = add(project, 'PBXFileReference', {
        lastKnownFileType: FILE_TYPES[path.extname(file)] || 'text',
        path: quote(file),
        sourceTree: '"<group>"',
    }, file, `file:${file}`);
    group.children.push({ value: uuid, comment: file });
    return uuid;
}

function ensureBuildFile(project, phaseUuid, phaseIsa, phaseName, fileRef, file, settings) {
    const objects = project.hash.project.objects;
    const phase = section(objects, phaseIsa)[phaseUuid];
    const buildFiles = section(objects, 'PBXBuildFile');
    if (phase.files.some((entry) => buildFiles[entry.value] && buildFiles[entry.value].fileRef === fileRef)) {
        return;
    }
    const comment = `${file} in ${phaseName}`;
    const object = { fileRef, fileRef_comment: file };
    if (settings) {
        object.settings = settings;
    }
    const uuid = add(project, 'PBXBuildFile', object, comment, `build:${comment}`);
    phase.files.push({ value: uuid, comment });
}

function addPhase(project, isa, name, extra) {
    return add(project, isa, Object.assign({
        buildActionMask: 2147483647,
        files: [],
        runOnlyForDeploymentPostprocessing: 0,
    }, extra || {}), name, `phase:${name}`);
}

/** The extension's target, with its product, phases and build configurations (named as the app's). */
function ensureTarget(project, appTarget, xcconfigRef) {
    const objects = project.hash.project.objects;
    const [existing] = findTarget(objects, NAME);
    if (existing) {
        return existing;
    }
    // Cordova's template names no productRefGroup: the products group is the one that holds the app.
    const groups = section(objects, 'PBXGroup');
    const firstProject = project.getFirstProject().firstProject;
    const productsGroup = groups[firstProject.productRefGroup] ||
        items(groups).map(([, group]) => group)
            .find((group) => (group.children || []).some((child) => child.value === appTarget.productReference)) ||
        groups[firstProject.mainGroup];
    const productUuid = add(project, 'PBXFileReference', {
        explicitFileType: '"wrapper.app-extension"',
        includeInIndex: 0,
        path: PRODUCT,
        sourceTree: 'BUILT_PRODUCTS_DIR',
    }, PRODUCT, 'product');
    productsGroup.children.push({ value: productUuid, comment: PRODUCT });

    const configRefs = buildConfigurations(objects, appTarget.buildConfigurationList).map(([, config]) => {
        const name = unquote(config.name);
        const uuid = add(project, 'XCBuildConfiguration', {
            baseConfigurationReference: xcconfigRef,
            baseConfigurationReference_comment: XCCONFIG,
            buildSettings: {},
            name: config.name,
        }, name, `config:${name}`);
        return { value: uuid, comment: name };
    });
    const listComment = `Build configuration list for PBXNativeTarget "${NAME}"`;
    const listUuid = add(project, 'XCConfigurationList', {
        buildConfigurations: configRefs,
        defaultConfigurationIsVisible: 0,
        defaultConfigurationName: 'Release',
    }, listComment, 'configurations');

    const phases = [
        ['PBXSourcesBuildPhase', 'Sources'],
        ['PBXFrameworksBuildPhase', 'Frameworks'],
        ['PBXResourcesBuildPhase', 'Resources'],
    ].map(([isa, name]) => ({ value: addPhase(project, isa, name), comment: name }));

    const targetUuid = add(project, 'PBXNativeTarget', {
        buildConfigurationList: listUuid,
        buildConfigurationList_comment: listComment,
        buildPhases: phases,
        buildRules: [],
        dependencies: [],
        name: NAME,
        productName: NAME,
        productReference: productUuid,
        productReference_comment: PRODUCT,
        productType: '"com.apple.product-type.app-extension"',
    }, NAME, 'target');
    firstProject.targets.push({ value: targetUuid, comment: NAME });
    return targetUuid;
}

/** The app builds the extension first and copies it into PlugIns, before the script phases (CocoaPods'). */
function ensureEmbedded(project, appTargetUuid, extensionUuid) {
    const objects = project.hash.project.objects;
    const appTarget = section(objects, 'PBXNativeTarget')[appTargetUuid];
    const extension = section(objects, 'PBXNativeTarget')[extensionUuid];

    const dependencies = section(objects, 'PBXTargetDependency');
    const hasDependency = appTarget.dependencies.some((entry) => dependencies[entry.value] &&
        dependencies[entry.value].target === extensionUuid);
    if (!hasDependency) {
        const proxyUuid = add(project, 'PBXContainerItemProxy', {
            containerPortal: project.getFirstProject().uuid,
            containerPortal_comment: 'Project object',
            proxyType: 1,
            remoteGlobalIDString: extensionUuid,
            remoteInfo: NAME,
        }, 'PBXContainerItemProxy', 'proxy');
        const dependencyUuid = add(project, 'PBXTargetDependency', {
            target: extensionUuid,
            target_comment: NAME,
            targetProxy: proxyUuid,
            targetProxy_comment: 'PBXContainerItemProxy',
        }, 'PBXTargetDependency', 'dependency');
        appTarget.dependencies.push({ value: dependencyUuid, comment: 'PBXTargetDependency' });
    }

    const copyPhases = section(objects, 'PBXCopyFilesBuildPhase');
    let embed = appTarget.buildPhases.find((entry) => copyPhases[entry.value] &&
        String(copyPhases[entry.value].dstSubfolderSpec) === '13');
    if (!embed) {
        const uuid = addPhase(project, 'PBXCopyFilesBuildPhase', EMBED_PHASE, {
            dstPath: '""',
            dstSubfolderSpec: 13,
            name: quote(EMBED_PHASE),
        });
        embed = { value: uuid, comment: EMBED_PHASE };
        const resources = section(objects, 'PBXResourcesBuildPhase');
        const after = appTarget.buildPhases.findIndex((entry) => resources[entry.value]);
        appTarget.buildPhases.splice(after >= 0 ? after + 1 : appTarget.buildPhases.length, 0, embed);
    }
    ensureBuildFile(project, embed.value, 'PBXCopyFilesBuildPhase', EMBED_PHASE, extension.productReference, PRODUCT,
        { ATTRIBUTES: ['RemoveHeadersOnCopy'] });
}

/** Cordova keeps the project it parsed in memory and writes it back when it signs: it must read ours instead. */
function forgetCordovaProject(iosRoot) {
    for (const key of Object.keys(require.cache)) {
        if (/cordova-ios[\\/]lib[\\/]projectFile\.js$/.test(key)) {
            const projectFile = require.cache[key].exports;
            if (projectFile && typeof projectFile.purgeProjectFileCache === 'function') {
                for (const dir of new Set([iosRoot, path.resolve(iosRoot), fs.realpathSync(iosRoot)])) {
                    projectFile.purgeProjectFileCache(dir);
                }
            }
        }
    }
}

module.exports = function (context) {
    const platforms = (context.opts && context.opts.platforms) || [];
    if (!platforms.includes('ios')) {
        return;
    }
    const projectRoot = context.opts.projectRoot;
    const iosRoot = path.join(projectRoot, 'platforms', 'ios');
    const xcodeproj = fs.existsSync(iosRoot) && fs.readdirSync(iosRoot).find((name) => name.endsWith('.xcodeproj'));
    if (!xcodeproj) {
        return;
    }
    const projectName = path.basename(xcodeproj, '.xcodeproj');
    const plist = requireFromCordovaIos(projectRoot, 'plist');
    const xcode = requireFromCordovaIos(projectRoot, 'xcode');
    const { ConfigParser } = context.requireCordovaModule('cordova-common');

    const config = new ConfigParser(path.join(projectRoot, 'config.xml'));
    const appId = config.getAttribute('ios-CFBundleIdentifier') || config.packageName();
    const bundleId = `${appId}.${NAME}`;
    const appInfo = plist.parse(fs.readFileSync(path.join(iosRoot, projectName, `${projectName}-Info.plist`), 'utf8'));
    const signing = releaseSigning(context, projectRoot, bundleId);

    const pbxPath = path.join(iosRoot, xcodeproj, 'project.pbxproj');
    const project = xcode.project(pbxPath);
    project.parseSync();
    const objects = project.hash.project.objects;
    const [appTargetUuid, appTarget] = findTarget(objects, projectName);
    if (!appTarget) {
        throw new Error(`${NAME}: no target "${projectName}" in ${pbxPath}`);
    }
    const appRelease = buildConfigurations(objects, appTarget.buildConfigurationList)
        .map(([, buildConfig]) => buildConfig).find((buildConfig) => unquote(buildConfig.name) === 'Release');

    writeExtensionFiles(projectRoot, iosRoot, appInfo, appId, projectName,
        xcconfig(bundleId, (appRelease && appRelease.buildSettings) || {}, signing));

    const groupUuid = ensureGroup(project);
    const xcconfigRef = ensureFileReference(project, groupUuid, XCCONFIG);
    const extensionUuid = ensureTarget(project, appTarget, xcconfigRef);
    const extensionTarget = section(objects, 'PBXNativeTarget')[extensionUuid];
    const sourcesPhase = extensionTarget.buildPhases.find((entry) => section(objects, 'PBXSourcesBuildPhase')[entry.value]);
    for (const file of SOURCES) {
        const fileRef = ensureFileReference(project, groupUuid, file);
        ensureBuildFile(project, sourcesPhase.value, 'PBXSourcesBuildPhase', 'Sources', fileRef, file);
    }
    for (const file of HEADERS.concat([INFO_PLIST, ENTITLEMENTS])) {
        ensureFileReference(project, groupUuid, file);
    }
    ensureEmbedded(project, appTargetUuid, extensionUuid);

    fs.writeFileSync(pbxPath, project.writeSync());
    forgetCordovaProject(iosRoot);
    console.log(`${NAME}: ${bundleId} ${appInfo.CFBundleShortVersionString} (${appInfo.CFBundleVersion}), ` +
        `embedded in ${projectName}${signing ? `, signed with profile ${signing.profile}` : ''}`);
};
