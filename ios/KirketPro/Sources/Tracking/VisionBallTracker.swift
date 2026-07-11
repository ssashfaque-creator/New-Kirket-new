@preconcurrency import AVFoundation
import Foundation
import ImageIO
import Vision

struct NativeTrackResult: Sendable {
    let observations: [BallObservation]
    let longestGapFrames: Int
    let averageConfidence: Double

    var isUsable: Bool {
        observations.count >= 8 &&
        longestGapFrames <= 4 &&
        averageConfidence >= 0.65
    }
}

final class VisionBallTracker: @unchecked Sendable {
    func track(
        assetURL: URL,
        contactTime: CMTime,
        seedBoundingBox: CGRect,
        beforeSeconds: Double = 0.22,
        afterSeconds: Double = 1.15
    ) async throws -> NativeTrackResult {
        let asset = AVURLAsset(url: assetURL)
        let orientation = try await videoOrientation(asset: asset)
        let beforeStart = CMTimeMaximum(
            .zero,
            contactTime - CMTime(seconds: beforeSeconds, preferredTimescale: 600)
        )
        async let beforeFrames = readFrames(
            asset: asset,
            range: CMTimeRange(start: beforeStart, end: contactTime)
        )
        async let afterFrames = readFrames(
            asset: asset,
            range: CMTimeRange(
                start: contactTime,
                duration: CMTime(seconds: afterSeconds, preferredTimescale: 600)
            )
        )

        let (before, after) = try await (beforeFrames, afterFrames)
        let backwardTracked = try await trackSequence(
            frames: before.reversed(),
            initialBox: seedBoundingBox,
            orientation: orientation
        )
        let backward = backwardTracked.reversed()
        let forward = try await trackSequence(
            frames: after,
            initialBox: seedBoundingBox,
            orientation: orientation
        )
        let combined = deduplicate(Array(backward) + forward)
        let confidence = combined.map(\.confidence).reduce(0, +) / Double(max(combined.count, 1))
        return NativeTrackResult(
            observations: combined,
            longestGapFrames: longestTemporalGap(combined),
            averageConfidence: confidence
        )
    }

    private struct Frame: @unchecked Sendable {
        let pixelBuffer: CVPixelBuffer
        let time: CMTime
    }

    private func readFrames(
        asset: AVAsset,
        range: CMTimeRange
    ) async throws -> [Frame] {
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard let track = tracks.first else { throw TrackingError.videoTrackMissing }
        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = range
        let output = AVAssetReaderTrackOutput(
            track: track,
            outputSettings: [
                kCVPixelBufferPixelFormatTypeKey as String:
                    kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
            ]
        )
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { throw TrackingError.readerOutputUnavailable }
        reader.add(output)
        guard reader.startReading() else {
            throw reader.error ?? TrackingError.readerFailed
        }
        var frames: [Frame] = []
        while let sample = output.copyNextSampleBuffer(),
              let buffer = CMSampleBufferGetImageBuffer(sample) {
            frames.append(
                Frame(
                    pixelBuffer: buffer,
                    time: CMSampleBufferGetPresentationTimeStamp(sample)
                )
            )
        }
        if reader.status == .failed {
            throw reader.error ?? TrackingError.readerFailed
        }
        return frames
    }

    private func trackSequence<S: Sequence>(
        frames: S,
        initialBox: CGRect,
        orientation: CGImagePropertyOrientation
    ) async throws -> [BallObservation] where S.Element == Frame {
        let handler = VNSequenceRequestHandler()
        var input = VNDetectedObjectObservation(boundingBox: initialBox)
        var output: [BallObservation] = []
        var lowConfidenceCount = 0

        for frame in frames {
            let request = VNTrackObjectRequest(detectedObjectObservation: input)
            request.trackingLevel = .accurate
            try handler.perform([request], on: frame.pixelBuffer, orientation: orientation)
            guard let result = request.results?.first as? VNDetectedObjectObservation else {
                lowConfidenceCount += 1
                if lowConfidenceCount > 4 { break }
                continue
            }
            input = result
            let confidence = Double(result.confidence)
            if confidence < 0.35 {
                lowConfidenceCount += 1
                if lowConfidenceCount > 4 { break }
            } else {
                lowConfidenceCount = 0
            }
            let rawWidth = CGFloat(CVPixelBufferGetWidth(frame.pixelBuffer))
            let rawHeight = CGFloat(CVPixelBufferGetHeight(frame.pixelBuffer))
            let swapsAxes = orientation == .left || orientation == .leftMirrored ||
                orientation == .right || orientation == .rightMirrored
            let width = swapsAxes ? rawHeight : rawWidth
            let height = swapsAxes ? rawWidth : rawHeight
            let box = result.boundingBox
            let center = CGPoint(
                x: box.midX * width,
                y: (1 - box.midY) * height
            )
            output.append(
                BallObservation(
                    presentationTime: frame.time,
                    centerPixels: center,
                    radiusPixels: Double((box.width * width + box.height * height) / 4),
                    confidence: confidence,
                    source: .visionTracker
                )
            )
        }
        return output
    }

    private func videoOrientation(asset: AVAsset) async throws -> CGImagePropertyOrientation {
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard let track = tracks.first else { throw TrackingError.videoTrackMissing }
        let transform = try await track.load(.preferredTransform)
        switch (transform.a, transform.b, transform.c, transform.d) {
        case (0, 1, -1, 0):
            return .right
        case (0, -1, 1, 0):
            return .left
        case (-1, 0, 0, -1):
            return .down
        default:
            return .up
        }
    }

    private func deduplicate(_ observations: [BallObservation]) -> [BallObservation] {
        var seen = Set<Int64>()
        return observations
            .sorted { $0.presentationTime < $1.presentationTime }
            .filter { observation in
                let key = observation.presentationTime.convertScale(600_000, method: .roundHalfAwayFromZero).value
                return seen.insert(key).inserted
            }
    }

    private func longestTemporalGap(_ observations: [BallObservation]) -> Int {
        guard observations.count >= 2 else { return 0 }
        let deltas = zip(observations, observations.dropFirst()).map {
            CMTimeGetSeconds($1.presentationTime - $0.presentationTime)
        }
        let nominal = deltas.filter { $0 > 0 }.min() ?? 1 / 120
        return deltas.map { max(0, Int(round($0 / nominal)) - 1) }.max() ?? 0
    }
}

enum TrackingError: LocalizedError {
    case videoTrackMissing
    case readerOutputUnavailable
    case readerFailed

    var errorDescription: String? {
        switch self {
        case .videoTrackMissing:
            "The recording has no readable video track."
        case .readerOutputUnavailable:
            "The high-speed video track could not be decoded."
        case .readerFailed:
            "Video frame reading failed."
        }
    }
}
