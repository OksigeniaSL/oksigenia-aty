// Finds texts in a screenshot with macOS's own text recognition (Vision), for scripts/oksigenia-store-shots.sh: the
// app's screens are web content, which the simulator's accessibility tree does not show.
//
//   swiftc -O oksigenia-ocr.swift -o ocr && ./ocr screen.png "Hola" "Abrir el sitio" "=Abrir"
//
// The texts go in order of preference. Prints "N x y" for the first one on the screen: N is its place in the list
// (1, 2…) and x y the centre of the text in image pixels; exits 1 when none is there. A text that starts with "=" only
// counts as a line of its own: the button «Abrir» under the title «¿Abrir en Oksigenia Aty?».
import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 3, let image = NSImage(contentsOfFile: args[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("usage: ocr <image> <text>…\n".data(using: .utf8)!)
    exit(2)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["es-ES", "en-US"]
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([request])

let width = Double(cg.width), height = Double(cg.height)
let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
let lines = (request.results ?? []).compactMap { obs in obs.topCandidates(1).first.map { (obs, $0) } }

for (index, wanted) in args.dropFirst(2).enumerated() {
    let exact = wanted.hasPrefix("=")
    let text = exact ? String(wanted.dropFirst()) : wanted
    for (observation, candidate) in lines {
        let line = candidate.string.trimmingCharacters(in: .whitespaces)
        if exact && line.compare(text, options: options) != .orderedSame {
            continue
        }
        guard let range = candidate.string.range(of: text, options: options) else {
            continue
        }
        // The box of the words themselves: two buttons side by side may come as one line.
        let box = (try? candidate.boundingBox(for: range))?.boundingBox ?? observation.boundingBox
        print(index + 1, Int(box.midX * width), Int((1 - box.midY) * height))
        exit(0)
    }
}
exit(1)
