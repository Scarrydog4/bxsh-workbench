import SwiftUI
import WebKit
import UIKit

private let workbenchURL = URL(string: "https://workbench.example.com/")!

final class WorkbenchState: ObservableObject {
    @Published var progress: Double = 0
    @Published var error = false
    weak var webView: WKWebView?
    func retry() { error = false; webView?.load(URLRequest(url: workbenchURL)) }
}

@main struct WorkbenchApp: App {
    @StateObject private var state = WorkbenchState()
    var body: some Scene {
        WindowGroup {
            ZStack(alignment: .top) {
                WorkbenchWebView(state: state)
                if state.progress > 0 && state.progress < 1 {
                    ProgressView(value: state.progress).tint(Color(red: 0.1, green: 0.45, blue: 0.37))
                }
                if state.error {
                    VStack(spacing: 20) {
                        Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                        Text("暂时连不上工作台").font(.headline)
                        Button("重新连接") { state.retry() }.buttonStyle(.borderedProminent).tint(Color(red: 0.1, green: 0.45, blue: 0.37))
                    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color(.systemBackground))
                }
            }
        }
    }
}

struct WorkbenchWebView: UIViewRepresentable {
    @ObservedObject var state: WorkbenchState
    func makeCoordinator() -> Coordinator { Coordinator(state: state) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        state.webView = view
        context.coordinator.progress = view.observe(\.estimatedProgress, options: [.new]) { [weak state] webView, _ in
            DispatchQueue.main.async { state?.progress = webView.estimatedProgress }
        }
        view.load(URLRequest(url: workbenchURL))
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKDownloadDelegate {
        let state: WorkbenchState
        var progress: NSKeyValueObservation?
        private var destinations: [ObjectIdentifier: URL] = [:]
        init(state: WorkbenchState) { self.state = state }
        func webView(_ view: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            let internalURL = url.scheme == "https" && url.host == workbenchURL.host && (url.port == nil || url.port == 443)
            if internalURL || url.scheme == "blob" || url.scheme == "about" {
                if action.shouldPerformDownload { decisionHandler(.download) }
                else if action.targetFrame == nil { view.load(action.request); decisionHandler(.cancel) }
                else { decisionHandler(.allow) }
            } else {
                decisionHandler(.cancel)
                if ["https", "http", "mailto", "tel"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            }
        }
        func webView(_ view: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            decisionHandler(response.canShowMIMEType ? .allow : .download)
        }
        func webView(_ view: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { state.error = true }
        }
        func webView(_ view: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { state.error = true }
        }
        func webView(_ view: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ view: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let name = (suggestedFilename as NSString).lastPathComponent
                let destination = folder.appendingPathComponent(name.isEmpty ? "工作台附件" : name)
                destinations[ObjectIdentifier(download)] = destination
                completionHandler(destination)
            } catch { completionHandler(nil) }
        }
        func downloadDidFinish(_ download: WKDownload) {
            guard let destination = destinations.removeValue(forKey: ObjectIdentifier(download)),
                  let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
                  var controller = scene.windows.first(where: \.isKeyWindow)?.rootViewController else { return }
            while let presented = controller.presentedViewController { controller = presented }
            let share = UIActivityViewController(activityItems: [destination], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = controller.view
            share.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
            controller.present(share, animated: true)
        }
        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { destinations.removeValue(forKey: ObjectIdentifier(download)) }
    }
}
