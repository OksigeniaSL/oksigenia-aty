// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Injectable } from '@angular/core';

import { CoreError } from '@classes/errors/error';
import { CoreWSError } from '@classes/errors/wserror';
import { CoreContentLinksDelegate } from '@features/contentlinks/services/contentlinks-delegate';
import { CoreContentLinksHelper } from '@features/contentlinks/services/contentlinks-helper';
import { CoreLoginHelper, CoreLoginSSOData } from '@features/login/services/login-helper';
import { ApplicationInit, makeSingleton, Translate } from '@singletons';
import { CoreLogger } from '@static/logger';
import { CorePath } from '@static/path';
import { CoreConstants } from '../constants';
import { CoreWS, HttpRequestOptions } from '@services/ws';
import { CoreSSO } from '@static/sso';
import { CoreNavigator, CoreRedirectPayload } from './navigator';
import { CoreSiteCheckResponse, CoreSites } from './sites';
import { CoreErrorHelper, CoreErrorObject } from './error-helper';
import { CoreUrl } from '@static/url';
import { CoreLoadings } from './overlays/loadings';
import { CoreAlerts } from './overlays/alerts';
import { CorePrompts } from './overlays/prompts';
import { CorePlatform } from './platform';
import { CoreLang } from '@services/lang';
import { CoreCanceledError } from '@classes/errors/cancelederror';
import { NO_SITE_ID } from '@features/login/constants';

/**
 * What local/oksigeniaaty/token.php answers when the app exchanges a one-time key.
 */
type AtyTokenResponse = {
    token?: string;
    privatetoken?: string;
    siteurl?: string;
    lang?: string;
    needspin?: boolean; // The user has a PIN set and it was missing or wrong; the key was not consumed.
    needspinsetup?: boolean; // Signed in, but no PIN yet: offer to set one (trust on first use).
    locked?: boolean; // Too many wrong PINs; verification is temporarily locked.
    pinprompt?: string; // Localised "enter your PIN" message (the server knows the user's language).
    pinsetupprompt?: string; // Localised "create a PIN" message.
    error?: string; // Localised error (wrong PIN, locked, or a generic failure).
};

/*
 * Provider to handle custom URL schemes.
 */
@Injectable({ providedIn: 'root' })
export class CoreCustomURLSchemesProvider {

    protected logger: CoreLogger;
    protected lastUrls: Record<string, number> = {};

    constructor() {
        this.logger = CoreLogger.getInstance('CoreCustomURLSchemesProvider');
    }

    /**
     * Create a CoreCustomURLSchemesHandleError to be used when treating a URL that doesn't have a valid scheme.
     *
     * @param url URL that caused the error.
     * @param data Data obtained from the URL (if any).
     * @returns Error.
     */
    protected createInvalidSchemeError(url: string, data?: CoreCustomURLSchemesParams): CoreCustomURLSchemesHandleError {
        const defaultError = new CoreError(Translate.instant('core.login.invalidsite'), { debug: {
            code: 'invalidurlscheme',
            details: `Error when treating a URL scheme, it seems the URL is not valid.<br><br>URL: ${url}`,
        } });

        return new CoreCustomURLSchemesHandleError(defaultError, data);
    }

    /**
     * Given some data of a custom URL with a token, create a site if it needs to be created.
     *
     * @param token Token to use to create the site.
     * @param data URL data.
     * @returns Site ID if created or already exists.
     */
    protected async createSiteIfNeeded(token: string, data: CoreCustomURLSchemesParams): Promise<string> {
        const currentSite = CoreSites.getCurrentSite();

        if (!currentSite || currentSite.getToken() !== token || currentSite.isLoggedOut()) {
            // Token belongs to a different site or site is logged out, create it. It doesn't matter if it already exists.
            if (!data.siteUrl.match(/^https?:\/\//)) {
                // URL doesn't have a protocol and it's required to be able to create the site. Check which one to use.
                const result = await CoreSites.checkSite(data.siteUrl, undefined, 'URL scheme create site');

                data.siteUrl = result.siteUrl;

                await CoreSites.checkApplication(result.config);
            }

            if (!data.isSSOToken) {
                // Confirm before creating the site.
                await CoreContentLinksHelper.confirmLinkToSite({ url: data.siteUrl });
            }

            return CoreSites.newSite(
                data.siteUrl,
                token,
                data.privateToken,
                !!data.isSSOToken,
                CoreLoginHelper.getOAuthIdFromParams(data.ssoUrlParams),
            );
        } else {
            // Token belongs to current site, no need to create it.
            return CoreSites.getCurrentSiteId();
        }
    }

    /**
     * Handle an URL received by custom URL scheme.
     *
     * @param url URL to treat.
     * @returns Promise resolved when done. If rejected, the parameter is of type CoreCustomURLSchemesHandleError.
     */
    async handleCustomURL(url: string): Promise<void> {
        if (!this.isCustomURL(url)) {
            throw this.createInvalidSchemeError(url);
        }

        // Check if there is nothing valid after the URL scheme.
        const urlWithoutScheme = this.removeCustomURLScheme(url).trim();
        if (!urlWithoutScheme || urlWithoutScheme.match(/^\/?(#.*)?\/?$/)) {
            throw this.createInvalidSchemeError(url);
        }

        /* First check that this URL hasn't been treated a few seconds ago. The function that handles custom URL schemes already
           does this, but this function is called from other places so we need to handle it in here too. */
        if (this.lastUrls[url] && Date.now() - this.lastUrls[url] < 3000) {
            // Function called more than once, stop.
            return;
        }

        this.lastUrls[url] = Date.now();
        url = CoreUrl.decodeURIComponent(url);

        // Wait for app to be ready.
        await ApplicationInit.donePromise;

        // Some platforms like Windows add a slash at the end. Remove it.
        // Some sites add a # at the end of the URL. If it's there, remove it.
        url = url.replace(/\/?(#.*)?\/?$/, '');

        const modal = await CoreLoadings.show();
        let data: CoreCustomURLSchemesParams;

        // Get the data from the URL.
        try {
            if (this.isCustomURLAtyLogin(url)) {
                data = await this.getCustomURLAtyLoginData(url);
            } else if (this.isCustomURLToken(url)) {
                data = await this.getCustomURLTokenData(url);
            } else if (this.isCustomURLLink(url)) {
                // In iOS, the protocol after the scheme doesn't have ":". Add it.
                url = url.replace(/\/\/link=(https?)\/\//, '//link=$1://');

                data = await this.getCustomURLLinkData(url);
            } else {
                // In iOS, the protocol after the scheme doesn't have ":". Add it.
                url = url.replace(/\/\/(https?)\/\//, '//$1://');

                data = await this.getCustomURLData(url);
            }
        } catch (error) {
            await modal.dismiss();

            throw error;
        }

        try {
            const isValid = await CoreLoginHelper.isSiteUrlAllowed(data.siteUrl);

            if (!isValid) {
                throw Translate.instant('core.errorurlschemeinvalidsite');
            }

            if (data.redirect && data.redirect.match(/^https?:\/\//) && !data.redirect.includes(data.siteUrl)) {
                // Redirect URL must belong to the same site. Reject.
                throw Translate.instant('core.contentlinks.errorredirectothersite');
            }

            if (data.redirect && !data.redirect.match(/^https?:\/\//)) {
                // Redirect is a relative URL. Append the site URL.
                data.redirect = CorePath.concatenatePaths(data.siteUrl, data.redirect);
            }

            // Check if the site needs to be created and ask the user to confirm if needed.
            let siteIds: string[];
            if (data.token) {
                const siteId = await this.createSiteIfNeeded(data.token, data);

                if (data.isSSOToken || (data.isAuthenticationURL && siteId && CoreSites.getCurrentSiteId() === siteId)) {
                    // Site created and authenticated, open the page to go.
                    void CoreNavigator.navigateToSiteHome({
                        params: <CoreRedirectPayload> {
                            redirectPath: data.redirectPath,
                            redirectOptions: data.redirectOptions,
                            urlToOpen: data.urlToOpen ?? data.redirect,
                        },
                    });

                    return;
                }

                siteIds = [siteId];
            } else {
                siteIds = await CoreSites.getSiteIdsFromUrl(data.siteUrl, {
                    prioritize: true,
                    username: data.username,
                    userId: data.userId,
                });

                if (siteIds.length !== 1 || siteIds[0] !== CoreSites.getCurrentSiteId()) {
                    // Not current site or more than one site, confirm before changing site.
                    await CoreContentLinksHelper.confirmLinkToSite({ url: data.siteUrl });
                }
            }

            if (siteIds.length > 1) {
                // More than one site to treat the URL, let the user choose.
                void CoreContentLinksHelper.goToChooseSite(data.redirect || data.siteUrl);
            } else if (siteIds.length === 1) {
                // Only one site, handle the link.
                // No need to confirm site change here: handleLink and handleRootURL will do it if needed.
                const site = await CoreSites.getSite(siteIds[0]);

                if (!data.redirect) {
                    // No redirect, go to the root URL if needed.
                    await CoreContentLinksHelper.handleRootURL(site, {
                        checkToken: true,
                        confirmSiteChange: false,
                    });
                } else {
                    // Handle the redirect link.
                    await modal.dismiss(); // Dismiss modal so it doesn't collide with confirms.

                    /* Always use the username from the site in this case. If the link has a username and a token,
                       this will make sure that the link is opened with the user the token belongs to. */
                    const username = site.getInfo()?.username || data.username;

                    const treated = await CoreContentLinksHelper.handleLink(data.redirect, {
                        username,
                        confirmSiteChange: false,
                    });

                    if (!treated) {
                        CoreAlerts.showError(Translate.instant('core.contentlinks.errornoactions'));
                    }
                }

            } else {
                // Site not stored. Try to add the site.
                const result = await CoreSites.checkSite(data.siteUrl, undefined, `URL scheme redirect: ${url}`);

                await this.goToAddSite(data, result);
            }

        } catch (error) {
            if (CoreErrorHelper.isCanceledError(error)) {
                return;
            }

            if (!error || !CoreErrorHelper.getErrorMessageFromError(error)) {
                // Use a default error.
                this.createInvalidSchemeError(url, data);
            } else {
                throw new CoreCustomURLSchemesHandleError(error, data);
            }
        } finally {
            await modal.dismiss();

            if (data.isSSOToken) {
                CoreSSO.finishSSOAuthentication();
            }
        }
    }

    /**
     * Get the data from a custom URL scheme. The structure of the URL is:
     * moodlemobile://username@domain.com?token=TOKEN&privatetoken=PRIVATETOKEN&redirect=http://domain.com/course/view.php?id=2
     *
     * @param url URL to treat.
     * @returns Promise resolved with the data.
     */
    protected async getCustomURLData(url: string): Promise<CoreCustomURLSchemesParams> {
        if (!this.isCustomURL(url)) {
            throw this.createInvalidSchemeError(url);
        }

        // App opened using custom URL scheme.
        this.logger.debug(`Treating custom URL scheme: ${url}`);

        // Delete the sso scheme from the URL.
        url = this.removeCustomURLScheme(url);

        // Detect if there's a user specified.
        const username = CoreUrl.getUsernameFromUrl(url);
        if (username) {
            url = url.replace(`${username}@`, ''); // Remove the username from the URL.
        }

        // Get the params of the URL.
        const params = CoreUrl.extractUrlParams(url);

        // Remove the params to get the site URL.
        if (url.includes('?')) {
            url = url.substring(0, url.indexOf('?'));
        }

        if (!url.match(/https?:\/\//)) {
            // Url doesn't have a protocol. Check if the site is stored in the app to be able to determine the protocol.
            const siteIds = await CoreSites.getSiteIdsFromUrl(url, { prioritize: true, username });

            if (siteIds.length) {
                // There is at least 1 site with this URL. Use it to know the full URL.
                const site = await CoreSites.getSite(siteIds[0]);

                url = site.getURL();
            }
        }

        // Only allow using token authentication for https URLs. Also allow it for Behat tests since they use
        // deep links to speed up the execution and they use http URLs.
        const parsedUrl = CoreUrl.parse(url);
        const isSecureTokenSource = CorePlatform.isAutomated() ?
            true :
            parsedUrl?.protocol === 'https' && (!parsedUrl?.port || parsedUrl?.port === '443');

        return {
            siteUrl: url,
            username: username,
            token: isSecureTokenSource ? params.token : undefined,
            privateToken: isSecureTokenSource ? params.privateToken || params.privatetoken : undefined,
            redirect: params.redirect,
            isAuthenticationURL: isSecureTokenSource && !!params.token,
        };
    }

    /**
     * Get the data from a "link" custom URL scheme. This kind of URL is deprecated.
     *
     * @param url URL to treat.
     * @returns Promise resolved with the data.
     */
    protected async getCustomURLLinkData(url: string): Promise<CoreCustomURLSchemesParams> {
        if (!this.isCustomURLLink(url)) {
            throw this.createInvalidSchemeError(url);
        }

        // App opened using custom URL scheme.
        this.logger.debug(`Treating custom URL scheme with link param: ${url}`);

        // Delete the sso scheme from the URL.
        url = this.removeCustomURLLinkScheme(url);

        // Detect if there's a user specified.
        const username = CoreUrl.getUsernameFromUrl(url);
        if (username) {
            url = url.replace(`${username}@`, ''); // Remove the username from the URL.
        }

        // First of all, check if it's the root URL of a site.
        const data = await CoreSites.isStoredRootURL(url, username);

        if (data.site) {
            // Root URL.
            return {
                siteUrl: data.site.getURL(),
                username: username,
            };

        } else if (data.siteIds.length > 0) {
            // Not the root URL, but at least 1 site supports the URL. Get the site URL from the list of sites.
            const site = await CoreSites.getSite(data.siteIds[0]);

            return {
                siteUrl: site.getURL(),
                username: username,
                redirect: url,
            };

        } else {
            // Get the site URL.
            let siteUrl = CoreContentLinksDelegate.getSiteUrl(url);
            let redirect: string | undefined = url;

            if (!siteUrl) {
                // Site URL not found, use the original URL since it could be the root URL of the site.
                siteUrl = url;
                redirect = undefined;
            }

            return {
                siteUrl: siteUrl,
                username: username,
                redirect: redirect,
            };
        }
    }

    /**
     * Get the data from a "token" custom URL scheme. This kind of URL is deprecated.
     *
     * @param url URL to treat.
     * @returns Promise resolved with the data.
     */
    protected async getCustomURLTokenData(url: string): Promise<CoreCustomURLSchemesParams> {
        if (!this.isCustomURLToken(url)) {
            throw this.createInvalidSchemeError(url);
        }

        if (CoreSSO.isSSOAuthenticationOngoing()) {
            // Authentication ongoing, probably duplicated request.
            throw new CoreCustomURLSchemesHandleError('Duplicated');
        }

        // App opened using custom URL scheme. Probably an SSO authentication.
        CoreSSO.startSSOAuthentication();
        this.logger.debug('App launched by URL with an SSO');

        // Delete the sso scheme from the URL.
        const originalUrl = url;
        url = this.removeCustomURLTokenScheme(url);

        // Some platforms like Windows add a slash at the end. Remove it.
        // Some sites add a # at the end of the URL. If it's there, remove it.
        url = url.replace(/\/?#?\/?$/, '');

        // Decode from base64.
        try {
            url = atob(url);
        } catch (err) {
            // Error decoding the parameter.
            this.logger.error('Error decoding parameter received for login SSO');

            throw new CoreCustomURLSchemesHandleError(new CoreError(Translate.instant('core.login.invalidsite'), { debug: {
                code: 'errordecodingparameter',
                details: `Error when trying to decode base 64 string.<br><br>URL: ${originalUrl}<br><br>Text to decode: ${url}` +
                    `<br><br>Error: ${CoreErrorHelper.getErrorMessageFromError(err)}`,
            } }));
        }

        const data: CoreCustomURLSchemesParams = await CoreLoginHelper.validateBrowserSSOLogin(url);

        data.isSSOToken = true;
        data.isAuthenticationURL = true;

        return data;
    }

    /**
     * Go to page to add a site, or open a browser if SSO.
     *
     * @param data URL data.
     * @param siteCheck Result of checkSite.
     * @returns Promise resolved when done.
     */
    protected async goToAddSite(data: CoreCustomURLSchemesParams, siteCheck: CoreSiteCheckResponse): Promise<void> {
        const pageParams = {
            username: data.username,
            urlToOpen: data.redirect,
            siteCheck,
        };

        if (CoreSites.isLoggedIn()) {
            await CoreSites.logout({
                siteId: NO_SITE_ID,
                redirectPath: '/login/credentials',
                redirectOptions: { params: pageParams },
            });

            return;
        }

        await CoreNavigator.navigateToLoginCredentials(pageParams);
    }

    /**
     * Check whether a URL is a custom URL scheme.
     *
     * @param url URL to check.
     * @returns Whether it's a custom URL scheme.
     */
    isCustomURL(url: string): boolean {
        if (!url) {
            return false;
        }

        return url.includes(`${CoreConstants.CONFIG.customurlscheme}://`);
    }

    /**
     * Check whether a URL is a custom URL scheme with the "link" param (deprecated).
     *
     * @param url URL to check.
     * @returns Whether it's a custom URL scheme.
     */
    isCustomURLLink(url: string): boolean {
        if (!url) {
            return false;
        }

        return url.includes(`${CoreConstants.CONFIG.customurlscheme}://link=`);
    }

    /**
     * Check whether a URL is a custom URL scheme with a "token" param (deprecated).
     *
     * @param url URL to check.
     * @returns Whether it's a custom URL scheme.
     */
    isCustomURLToken(url: string): boolean {
        if (!url) {
            return false;
        }

        return url.includes(`${CoreConstants.CONFIG.customurlscheme}://token=`);
    }

    /**
     * Check whether a URL is an Oksigenia Aty sign-in URL (scheme://atylogin=...).
     *
     * @param url URL to check.
     * @returns Whether it's an Aty sign-in URL.
     */
    isCustomURLAtyLogin(url: string): boolean {
        if (!url) {
            return false;
        }

        return url.includes(`${CoreConstants.CONFIG.customurlscheme}://atylogin=`);
    }

    /**
     * Get the data needed to sign in from an Oksigenia Aty sign-in URL.
     *
     * The URL carries base64("siteurl:::key"); the one-time key is exchanged for an app token at the site's
     * local/oksigeniaaty/token.php, so no password is needed. Returns SSO-style data for the normal site creation flow.
     *
     * @param url The sign-in URL.
     * @returns The sign-in data.
     */
    protected async getCustomURLAtyLoginData(url: string): Promise<CoreCustomURLSchemesParams> {
        if (!this.isCustomURLAtyLogin(url)) {
            throw this.createInvalidSchemeError(url);
        }

        if (CoreSSO.isSSOAuthenticationOngoing()) {
            throw new CoreCustomURLSchemesHandleError('Duplicated');
        }

        CoreSSO.startSSOAuthentication();
        this.logger.debug('App launched by an Aty sign-in URL');

        // Once SSO is started, finish it on any failure so a cancelled or failed sign-in does not leave it stuck
        // "ongoing" (on success, handleCustomURL finishes it for us because isSSOToken is set).
        try {
            let payload = url.replace(`${CoreConstants.CONFIG.customurlscheme}://atylogin=`, '');
            payload = payload.replace(/\/?#?\/?$/, '');

            let decoded: string;
            try {
                // Accept standard base64 and base64url, padded or not.
                let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
                while (base64.length % 4) {
                    base64 += '=';
                }
                decoded = atob(base64);
            } catch {
                throw new CoreCustomURLSchemesHandleError(new CoreError(Translate.instant('core.login.invalidsite')));
            }

            const parts = decoded.split(':::');
            const siteUrl = parts[0];
            const key = parts[1];
            // Only ever sign in to an https site from a sign-in link; never cleartext.
            if (!siteUrl || !key || !/^https:\/\//i.test(siteUrl)) {
                throw new CoreCustomURLSchemesHandleError(new CoreError(Translate.instant('core.login.invalidsite')));
            }

            const tokenUrl = `${siteUrl}/local/oksigeniaaty/token.php`;

            // Exchange the key for a token. If the user has set a PIN, the server asks for it without consuming the
            // key, so we can prompt and retry until it is right (or the user cancels). All prompt text is localised
            // by the server (it knows the user's language), so the app ships no PIN strings of its own.
            let response = await this.postAtyKey(tokenUrl, { key });
            while (response?.needspin) {
                let pin: string;
                try {
                    const message = response.error || response.pinprompt || '';
                    pin = <string> await CorePrompts.show(message, 'tel', { placeholderOrLabel: 'PIN' });
                } catch {
                    // The user dismissed the PIN prompt.
                    throw new CoreCustomURLSchemesHandleError(new CoreCanceledError());
                }

                response = await this.postAtyKey(tokenUrl, { key, pin });
            }

            if (!response || !response.token) {
                throw new CoreCustomURLSchemesHandleError(new CoreError(Translate.instant('core.login.invalidaccount')));
            }

            // Trust on first use: no PIN yet, so offer to set one for next time (the user may skip it).
            if (response.needspinsetup && response.pinsetupprompt) {
                await this.offerAtyPinSetup(siteUrl, response.token, response.pinsetupprompt);
            }

            // Dress the app in the user's own language: open a link, land in your language.
            if (response.lang) {
                try {
                    await CoreLang.changeCurrentLanguage(response.lang);
                } catch {
                    // Keep the current language when the user's one is not available in the app.
                }
            }

            return {
                // The site from the link, never one the server claims.
                siteUrl,
                token: response.token,
                privateToken: response.privatetoken,
                isSSOToken: true,
                isAuthenticationURL: true,
            };
        } catch (error) {
            CoreSSO.finishSSOAuthentication();

            throw error;
        }
    }

    /**
     * POST a one-time key (and an optional PIN) to the site's token.php and return its parsed answer.
     *
     * Uses the native HTTP so it bypasses CORS; the key travels in the POST body, out of logs and the URL.
     *
     * @param tokenUrl The site's token.php URL.
     * @param data The key, and the PIN when the user is supplying one.
     * @returns The server's answer.
     */
    protected async postAtyKey(tokenUrl: string, data: { key: string; pin?: string }): Promise<AtyTokenResponse | null> {
        const options: HttpRequestOptions = {
            method: 'post',
            data,
        };

        try {
            const result = await CoreWS.sendHTTPRequest<AtyTokenResponse>(tokenUrl, options);

            return result.body;
        } catch (error) {
            throw new CoreCustomURLSchemesHandleError(new CoreError(Translate.instant('core.login.invalidsite'), {
                debug: { code: 'atylogintokenerror', details: CoreErrorHelper.getErrorMessageFromError(error) ?? '' },
            }));
        }
    }

    /**
     * After the first passwordless sign-in, offer to set a PIN for next time. Skipping is fine; it can be set later.
     *
     * @param siteUrl The site URL.
     * @param token The freshly minted app token.
     * @param message The localised invitation to set a PIN (from the server).
     */
    protected async offerAtyPinSetup(siteUrl: string, token: string, message: string): Promise<void> {
        let pin: string;
        try {
            pin = <string> await CorePrompts.show(message, 'tel', { placeholderOrLabel: 'PIN' });
        } catch {
            return; // Skipped; nothing to do.
        }

        if (!pin || !/^\d{4,8}$/.test(pin)) {
            return; // Not a usable PIN; let them set it later from their profile.
        }

        try {
            await CoreWS.call('local_oksigeniaaty_set_pin', { pin }, { wsToken: token, siteUrl });
        } catch {
            // Not critical: they stay signed in and can set a PIN another time.
        }
    }

    /**
     * Remove the scheme from a custom URL.
     *
     * @param url URL to treat.
     * @returns URL without scheme.
     */
    removeCustomURLScheme(url: string): string {
        return url.replace(`${CoreConstants.CONFIG.customurlscheme}://`, '');
    }

    /**
     * Remove the scheme and the "link=" prefix from a link custom URL.
     *
     * @param url URL to treat.
     * @returns URL without scheme and prefix.
     */
    removeCustomURLLinkScheme(url: string): string {
        return url.replace(`${CoreConstants.CONFIG.customurlscheme}://link=`, '');
    }

    /**
     * Remove the scheme and the "token=" prefix from a token custom URL.
     *
     * @param url URL to treat.
     * @returns URL without scheme and prefix.
     */
    removeCustomURLTokenScheme(url: string): string {
        return url.replace(`${CoreConstants.CONFIG.customurlscheme}://token=`, '');
    }

    /**
     * Treat error returned by handleCustomURL.
     *
     * @param error Error data.
     * @param url The URL that caused the error.
     * @param origin Origin of the treat handle error call.
     */
    treatHandleCustomURLError(error: CoreCustomURLSchemesHandleError, url = '', origin = 'unknown'): void {
        if (error.error === 'Duplicated') {
            // Duplicated request
        } else if (CoreWSError.isWebServiceError(error.error) && error.data && error.data.isSSOToken) {
            // An error occurred, display the error and logout the user.
            CoreLoginHelper.treatUserTokenError(error.data.siteUrl, <CoreWSError> error.error);
            CoreSites.logout();
        } else {
            CoreAlerts.showError(error.error ?? new CoreError(Translate.instant('core.login.invalidsite'), { debug: {
                code: 'unknownerror',
                details: `Unknown error when treating a URL scheme.<br><br>Origin: ${origin}.<br><br>URL: ${url}.`,
            } }));
        }
    }

    /**
     * Get the last URL used to open the app using a URL scheme.
     *
     * @returns URL.
     */
    getLastLaunchURL(): Promise<string | undefined> {
        if (!CorePlatform.isAndroid()) {
            // Last launch URL is only available in Android.
            return Promise.resolve(undefined);
        }

        return new Promise((resolve) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (<any> window).plugins.launchmyapp.getLastIntent(intent => resolve(intent), () => resolve(undefined));
        });
    }

    /**
     * Check if the last URL used to open the app was a token URL.
     *
     * @returns Whether was launched with token URL.
     */
    async appLaunchedWithTokenURL(): Promise<boolean> {
        const launchUrl = await this.getLastLaunchURL();

        return !!launchUrl && this.isCustomURLToken(launchUrl);
    }

}

/**
 * Error returned by handleCustomURL.
 */
export class CoreCustomURLSchemesHandleError extends CoreError {

    /**
     * Constructor.
     *
     * @param error The error message or object.
     * @param data Data obtained from the URL (if any).
     */
    constructor(public error: string | CoreError | CoreErrorObject | null, public data?: CoreCustomURLSchemesParams) {
        super(CoreErrorHelper.getErrorMessageFromError(error));
    }

}

export const CoreCustomURLSchemes = makeSingleton(CoreCustomURLSchemesProvider);

/**
 * All params that can be in a custom URL scheme.
 */
export type CoreCustomURLSchemesParams = CoreLoginSSOData & {

    /**
     * Username.
     */
    username?: string;

    /**
     * User Id.
     */
    userId?: number;

    /**
     * URL to open once authenticated.
     */
    redirect?: string;

    /**
     * Whether it's an SSO token URL.
     */
    isSSOToken?: boolean;

    /**
     * Whether the URL is meant to perform an authentication.
     */
    isAuthenticationURL?: boolean;
};
