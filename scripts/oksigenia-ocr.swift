// Finds a text in a screenshot with macOS's own text recognition (Vision), for scripts/oksigenia-store-shots.sh: the
// app's screens are web content, which the simulator's accessibility tree does not show.
//
//   swiftc -O oksigenia-ocr.swift -o ocr && ./ocr screen.png "Abrir el sitio"
//
// Prints "x y", the centre of the text in image pixels, and exits 0; exits 1 when the text is not on the screen.
import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count == 3, let image = NSImage(contentsOfFile: args[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("usage: ocr <image> <text>\n".data(using: .utf8)!)
    exit(2)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["es-ES", "en-US"]
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([request])

let width = Double(cg.width), height = Double(cg.height)
for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first,
          let range = candidate.string.range(of: args[2], options: [.caseInsensitive, .diacriticInsensitive]) else {
        continue
    }
    // The box of the words themselves: two buttons side by side may come as one line.
    let box = (try? candidate.boundingBox(for: range))?.boundingBox ?? observation.boundingBox
    print(Int(box.midX * width), Int((1 - box.midY) * height))
    exit(0)
}
exit(1)
