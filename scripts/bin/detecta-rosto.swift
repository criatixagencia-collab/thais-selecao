import Vision
import AppKit
import Foundation

guard CommandLine.arguments.count > 1,
      let img = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("{\"faces\":[]}"); exit(0)
}
let req = VNDetectFaceRectanglesRequest()
try? VNImageRequestHandler(cgImage: cg).perform([req])
let faces = (req.results ?? []).map { f -> String in
    let b = f.boundingBox
    return "{\"x\":\(b.origin.x),\"y\":\(b.origin.y),\"w\":\(b.width),\"h\":\(b.height)}"
}
print("{\"faces\":[\(faces.joined(separator: ","))]}")
