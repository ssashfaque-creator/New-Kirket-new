import CoreML
import CoreVideo
import Foundation
import Vision

struct NativeBallDetection: Sendable {
    let boundingBox: CGRect
    let confidence: Double
}

protocol NativeBallDetecting: Sendable {
    var isAvailable: Bool { get }
    func detect(in pixelBuffer: CVPixelBuffer) throws -> [NativeBallDetection]
}

final class CoreMLBallDetector: NativeBallDetecting, @unchecked Sendable {
    private let visionModel: VNCoreMLModel?

    init(bundle: Bundle = .main) {
        guard let url = bundle.url(forResource: "KirketBallDetector", withExtension: "mlmodelc"),
              let model = try? MLModel(contentsOf: url),
              let visionModel = try? VNCoreMLModel(for: model)
        else {
            self.visionModel = nil
            return
        }
        self.visionModel = visionModel
    }

    var isAvailable: Bool { visionModel != nil }

    func detect(in pixelBuffer: CVPixelBuffer) throws -> [NativeBallDetection] {
        guard let visionModel else { return [] }
        let request = VNCoreMLRequest(model: visionModel)
        request.imageCropAndScaleOption = .scaleFill
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up)
        try handler.perform([request])

        return (request.results as? [VNRecognizedObjectObservation] ?? [])
            .compactMap { observation in
                guard let label = observation.labels.first,
                      ["ball", "cricket_ball", "sports ball"].contains(label.identifier.lowercased())
                else {
                    return nil
                }
                return NativeBallDetection(
                    boundingBox: observation.boundingBox,
                    confidence: Double(label.confidence)
                )
            }
            .sorted { $0.confidence > $1.confidence }
    }
}
