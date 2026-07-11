import SwiftUI

@main
struct KirketProApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
        }
    }
}

private struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Picker("Stage", selection: $model.stage) {
                    ForEach(KirketStage.allCases) { stage in
                        Text(stage.rawValue).tag(stage)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                Group {
                    switch model.stage {
                    case .calibrate:
                        NativeCalibrationView()
                    case .capture:
                        NativeCaptureView()
                    case .review:
                        ShotReviewView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                Text(model.status)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)
                    .padding(.bottom, 8)
            }
            .navigationTitle("Kirket Pro")
        }
    }
}
