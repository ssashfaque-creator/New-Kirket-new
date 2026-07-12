@preconcurrency import AVFoundation
import ImageIO
import SwiftUI
import simd

struct NativeCalibrationView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var pipeline = NativeCalibrationPipeline()

    var body: some View {
        VStack(spacing: 12) {
            ZStack(alignment: .top) {
                CameraPreview(session: model.camera.session)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                RoundedRectangle(cornerRadius: 8)
                    .stroke(pipeline.isTargetVisible ? .green : .yellow, lineWidth: 3)
                    .aspectRatio(1, contentMode: .fit)
                    .padding(42)
                Text(pipeline.isTargetVisible ? "Hold still while corners average" : "Fit the full 160 mm QR (sheet C2) inside the square")
                    .font(.caption.bold())
                    .padding(8)
                    .background(.black.opacity(0.75), in: Capsule())
                    .padding()
            }

            ProgressView(
                value: Double(pipeline.stableFrameCount),
                total: Double(pipeline.requiredFrames)
            )
            .tint(pipeline.isTargetVisible ? .green : .yellow)

            HStack {
                Label("Stable frames: \(pipeline.stableFrameCount)/\(pipeline.requiredFrames)", systemImage: "viewfinder")
                Spacer()
                if let residual = pipeline.latestResidual {
                    Text(String(format: "%.2f px RMS", residual))
                        .monospacedDigit()
                }
            }
            .font(.footnote)

            VStack(alignment: .leading, spacing: 6) {
                Text("Professional calibration protocol").font(.headline)
                ForEach(Array(MetricCalibrationProtocol.inAppProtocolLines.enumerated()), id: \.offset) { _, line in
                    Text(line)
                }
                Text("The app measures only the 160 mm QR on C2. The other eight sheets are for visibility.")
                    .foregroundStyle(.secondary)
            }
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack {
                Button("Reset samples") { pipeline.reset() }
                    .buttonStyle(.bordered)
                Button("Accept metric calibration") {
                    if let solution = pipeline.solution {
                        model.acceptCalibration(solution)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(pipeline.solution?.isMeasurementReady != true)
            }
        }
        .padding()
        .task {
            pipeline.onSolution = { solution in
                model.status = solution.isMeasurementReady
                    ? "Stable C2 QR solved. Review residual, accept, then remove all nine sheets."
                    : "C2 QR moved too much. Hold still and reset."
            }
            model.camera.calibrationFrameHandler = { sampleBuffer in
                pipeline.consume(sampleBuffer)
            }
            await model.camera.requestPermissionAndConfigureCalibration()
        }
        .onDisappear {
            model.camera.calibrationFrameHandler = nil
        }
    }
}

final class NativeCalibrationPipeline: ObservableObject, @unchecked Sendable {
    @Published private(set) var stableFrameCount = 0
    @Published private(set) var isTargetVisible = false
    @Published private(set) var latestResidual: Double?
    @Published private(set) var solution: CalibrationSolution?

    let requiredFrames = 15
    var onSolution: ((CalibrationSolution) -> Void)?

    private let detector = CalibrationBoardDetector()
    private var accumulator = MetricCalibrationAccumulator(requiredFrames: 15)
    private let lock = NSLock()
    private var frameCounter = 0

    func consume(_ sampleBuffer: CMSampleBuffer) {
        lock.lock()
        frameCounter += 1
        let shouldProcess = frameCounter.isMultiple(of: 3)
        lock.unlock()
        guard shouldProcess, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        do {
            let observation = try detector.detect(pixelBuffer: pixelBuffer, orientation: .right)
            let intrinsics = cameraIntrinsics(
                from: sampleBuffer,
                orientation: .right,
                rawSize: CGSize(
                    width: CGFloat(CVPixelBufferGetWidth(pixelBuffer)),
                    height: CGFloat(CVPixelBufferGetHeight(pixelBuffer))
                )
            )
            lock.lock()
            if let observation {
                accumulator.append(observation)
            }
            let count = accumulator.observations.count
            let solved = intrinsics.flatMap { try? accumulator.solve(cameraIntrinsics: $0) }
            lock.unlock()
            Task { @MainActor [weak self] in
                guard let self else { return }
                isTargetVisible = observation != nil
                stableFrameCount = min(count, requiredFrames)
                if let solved {
                    solution = solved
                    latestResidual = solved.reprojectionErrorPixels
                    onSolution?(solved)
                }
            }
        } catch {
            Task { @MainActor [weak self] in self?.isTargetVisible = false }
        }
    }

    @MainActor
    func reset() {
        lock.lock()
        accumulator.reset()
        frameCounter = 0
        lock.unlock()
        stableFrameCount = 0
        latestResidual = nil
        solution = nil
    }

    private func cameraIntrinsics(
        from sampleBuffer: CMSampleBuffer,
        orientation: CGImagePropertyOrientation,
        rawSize: CGSize
    ) -> simd_double3x3? {
        guard
            let attachment = CMGetAttachment(
                sampleBuffer,
                key: kCMSampleBufferAttachmentKey_CameraIntrinsicMatrix,
                attachmentModeOut: nil
            ),
            CFGetTypeID(attachment) == CFDataGetTypeID()
        else {
            return nil
        }
        let data = attachment as! Data
        guard data.count >= MemoryLayout<simd_float3x3>.size else { return nil }
        let matrix = data.withUnsafeBytes { $0.load(as: simd_float3x3.self) }
        let raw = simd_double3x3(
            SIMD3(Double(matrix.columns.0.x), Double(matrix.columns.0.y), Double(matrix.columns.0.z)),
            SIMD3(Double(matrix.columns.1.x), Double(matrix.columns.1.y), Double(matrix.columns.1.z)),
            SIMD3(Double(matrix.columns.2.x), Double(matrix.columns.2.y), Double(matrix.columns.2.z))
        )
        guard orientation == .right else { return raw }
        let fx = raw.columns.0.x
        let fy = raw.columns.1.y
        let cx = raw.columns.2.x
        let cy = raw.columns.2.y
        return simd_double3x3(
            SIMD3(fy, 0, 0),
            SIMD3(0, fx, 0),
            SIMD3(Double(rawSize.height) - cy, cx, 1)
        )
    }
}
