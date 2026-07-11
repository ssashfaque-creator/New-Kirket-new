@preconcurrency import AVFoundation
import CoreImage
import SwiftUI

struct ShotReviewView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var review = ContactFrameReviewModel()
    @State private var ballDiameterMM = 72.0

    var body: some View {
        Group {
            if let url = model.camera.recordedURL {
                VStack(spacing: 12) {
                    if let frame = review.frame {
                        GeometryReader { geometry in
                            Image(decorative: frame, scale: 1)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .contentShape(Rectangle())
                                .overlay {
                                    if let box = review.seedBox {
                                        GeometryReader { proxy in
                                            let rect = displayRect(
                                                imageSize: CGSize(width: CGFloat(frame.width), height: CGFloat(frame.height)),
                                                container: proxy.size
                                            )
                                            Rectangle()
                                                .stroke(.yellow, lineWidth: 3)
                                                .frame(
                                                    width: box.width * rect.width,
                                                    height: box.height * rect.height
                                                )
                                                .position(
                                                    x: rect.minX + box.midX * rect.width,
                                                    y: rect.minY + (1 - box.midY) * rect.height
                                                )
                                        }
                                    }
                                }
                                .onTapGesture { location in
                                    review.setSeed(
                                        tap: location,
                                        container: geometry.size,
                                        imageSize: CGSize(width: CGFloat(frame.width), height: CGFloat(frame.height))
                                    )
                                }
                        }
                        .frame(minHeight: 300)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    } else {
                        ProgressView("Extracting contact frame…")
                            .frame(maxHeight: .infinity)
                    }

                    VStack {
                        Slider(
                            value: $review.contactSeconds,
                            in: 0...max(review.durationSeconds, 0.01),
                            step: 1 / 240
                        ) {
                            Text("Contact frame")
                        }
                        .onChange(of: review.contactSeconds) {
                            review.loadFrame(url: url)
                        }
                        HStack {
                            Text("Contact frame")
                            Spacer()
                            Text(String(format: "%.4f s", review.contactSeconds))
                                .monospacedDigit()
                        }
                        .font(.footnote)
                    }

                    HStack {
                        Button("Custom AI locate ball") {
                            Task { await review.detectWithCoreML() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(!review.customModelAvailable || review.frame == nil)

                        Button("Track before + after contact") {
                            Task {
                                guard let calibration = model.calibration else { return }
                                if let measurement = await review.trackAndFit(
                                    url: url,
                                    calibration: calibration,
                                    ballDiameterMeters: ballDiameterMM / 1000
                                ) {
                                    model.acceptMeasurement(measurement)
                                }
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(review.seedBox == nil || review.isBusy)
                    }

                    HStack {
                        Text("Measured ball diameter")
                        Slider(value: $ballDiameterMM, in: 65...78, step: 0.5)
                        Text("\(ballDiameterMM, specifier: "%.1f") mm")
                            .monospacedDigit()
                    }
                    .font(.footnote)

                    if let track = review.track {
                        HStack {
                            Label("\(track.observations.count) frames", systemImage: "film.stack")
                            Spacer()
                            Text("\(Int(track.averageConfidence * 100))% tracking")
                            Spacer()
                            Text("longest gap \(track.longestGapFrames)")
                        }
                        .font(.footnote)
                    }

                    if let error = review.errorMessage {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }

                    if !review.customModelAvailable {
                        Text("No KirketBallDetector.mlmodelc is bundled yet. Tap the ball manually; Vision tracking still works.")
                            .foregroundStyle(.secondary)
                            .font(.footnote)
                    }
                }
                .padding()
                .task { review.prepare(url: url) }
            } else if let measurement = model.latestMeasurement {
                MeasurementSummaryView(measurement: measurement)
            } else {
                ContentUnavailableView(
                    "No recorded delivery",
                    systemImage: "video.slash",
                    description: Text("Calibrate and record one high-speed delivery first.")
                )
            }
        }
    }

    private func displayRect(imageSize: CGSize, container: CGSize) -> CGRect {
        let scale = min(container.width / imageSize.width, container.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: (container.width - size.width) / 2,
            y: (container.height - size.height) / 2,
            width: size.width,
            height: size.height
        )
    }
}

@MainActor
final class ContactFrameReviewModel: ObservableObject {
    @Published var contactSeconds = 0.5
    @Published private(set) var durationSeconds = 1.0
    @Published private(set) var frame: CGImage?
    @Published private(set) var seedBox: CGRect?
    @Published private(set) var track: NativeTrackResult?
    @Published private(set) var isBusy = false
    @Published private(set) var errorMessage: String?

    private let detector = CoreMLBallDetector()
    private let tracker = VisionBallTracker()
    private let fitter = TrajectoryFitter()
    private let ciContext = CIContext()

    var customModelAvailable: Bool { detector.isAvailable }

    func prepare(url: URL) {
        Task {
            let asset = AVURLAsset(url: url)
            if let duration = try? await asset.load(.duration) {
                durationSeconds = CMTimeGetSeconds(duration)
                contactSeconds = min(max(0.1, durationSeconds / 2), max(0.1, durationSeconds - 0.1))
            }
            loadFrame(url: url)
        }
    }

    func loadFrame(url: URL) {
        let seconds = contactSeconds
        Task {
            do {
                let image = try await Task.detached(priority: .userInitiated) {
                    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
                    generator.appliesPreferredTrackTransform = true
                    generator.requestedTimeToleranceBefore = .zero
                    generator.requestedTimeToleranceAfter = .zero
                    return try generator.copyCGImage(
                        at: CMTime(seconds: seconds, preferredTimescale: 600),
                        actualTime: nil
                    )
                }.value
                frame = image
                seedBox = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func setSeed(tap: CGPoint, container: CGSize, imageSize: CGSize) {
        let scale = min(container.width / imageSize.width, container.height / imageSize.height)
        let rendered = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        let origin = CGPoint(
            x: (container.width - rendered.width) / 2,
            y: (container.height - rendered.height) / 2
        )
        let x = (tap.x - origin.x) / rendered.width
        let yTop = (tap.y - origin.y) / rendered.height
        guard (0...1).contains(x), (0...1).contains(yTop) else { return }
        let side = max(0.018, min(0.08, 34 / min(imageSize.width, imageSize.height)))
        seedBox = CGRect(x: x - side / 2, y: (1 - yTop) - side / 2, width: side, height: side)
    }

    func detectWithCoreML() async {
        guard let frame, let buffer = pixelBuffer(from: frame) else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            seedBox = try detector.detect(in: buffer).first?.boundingBox
            if seedBox == nil {
                errorMessage = "Custom model did not detect a ball. Tap it manually."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func trackAndFit(
        url: URL,
        calibration: CalibrationSolution,
        ballDiameterMeters: Double
    ) async -> NativeShotMeasurement? {
        guard let seedBox else { return nil }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let contact = CMTime(seconds: contactSeconds, preferredTimescale: 600)
            let result = try await tracker.track(
                assetURL: url,
                contactTime: contact,
                seedBoundingBox: seedBox
            )
            track = result
            guard result.isUsable else {
                throw ReviewError.trackQualityRejected
            }
            return try fitter.fit(
                observations: result.observations,
                contactTime: contact,
                calibration: calibration,
                ballDiameterMeters: ballDiameterMeters
            )
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    private func pixelBuffer(from image: CGImage) -> CVPixelBuffer? {
        var buffer: CVPixelBuffer?
        let attributes: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
        ]
        guard CVPixelBufferCreate(
            kCFAllocatorDefault,
            image.width,
            image.height,
            kCVPixelFormatType_32BGRA,
            attributes as CFDictionary,
            &buffer
        ) == kCVReturnSuccess, let buffer else {
            return nil
        }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer),
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
        ) else {
            return nil
        }
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return buffer
    }
}

private struct MeasurementSummaryView: View {
    let measurement: NativeShotMeasurement

    var body: some View {
        VStack(spacing: 14) {
            Text(measurement.isAccepted ? "Accepted shot" : "Rejected shot")
                .font(.title.bold())
                .foregroundStyle(measurement.isAccepted ? .green : .red)
            metric("Speed", String(format: "%.1f km/h", measurement.speedMetersPerSecond * 3.6))
            metric("Direction", String(format: "%.1f°", measurement.directionDegrees))
            metric("Launch", String(format: "%.1f°", measurement.launchAngleDegrees))
            metric("Residual", String(format: "%.1f cm", measurement.fitResidualMeters * 100))
            metric("Confidence", String(format: "%.0f%%", measurement.confidence * 100))
            ForEach(measurement.warnings, id: \.self) { warning in
                Text(warning).foregroundStyle(.yellow)
            }
        }
        .padding()
    }

    private func metric(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).monospacedDigit().bold()
        }
    }
}

enum ReviewError: LocalizedError {
    case trackQualityRejected

    var errorDescription: String? {
        "Track rejected: insufficient frames, confidence, or continuity. Correct the contact box or record again."
    }
}
