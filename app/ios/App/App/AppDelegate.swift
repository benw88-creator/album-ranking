import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // AMBIENT by default (2026-10-27). It follows the ringer switch and
        // mixes with whatever the person is already listening to, which is
        // right for interface sounds. It used to be .playback from launch,
        // which made every interface sound ignore the silent switch and let
        // the first one stop somebody's Spotify.
        //
        // Music still gets .playback: the page asks for it the moment a
        // preview starts (VinallNativePlugin.audioMode, driven by AudioMode in
        // assets/sound.js) and keeps it through a grace period and while the
        // app is in the background, so lock-screen controls and resume still
        // work. That plus the `audio` entry in UIBackgroundModes is what keeps
        // a preview playing behind the lock screen.
        //
        // Not activated here: activating at launch would interrupt whatever is
        // already playing just because the app opened.
        VinallAudio.apply("ambient")
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}


/// Interface feel and the audio session, in one small plugin registered by
/// VinallViewController. Haptics keep PREPARED generators, so a slider detent
/// lands on the frame rather than a beat late, and offer soft/rigid and
/// selection, which @capacitor/haptics' impact() does not.
enum VinallAudio {
    static var current = ""
    static func apply(_ mode: String) {
        guard mode != current else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            if mode == "playback" {
                try session.setCategory(.playback, mode: .default)
            } else {
                try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            }
            current = mode
        } catch {
            CAPLog.print("VINALL: could not set the audio session to \(mode) — \(error)")
        }
    }
}

@objc(VinallNativePlugin)
public class VinallNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VinallNativePlugin"
    public let jsName = "VinallNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "audioMode", returnType: CAPPluginReturnPromise)
    ]

    private lazy var selection = UISelectionFeedbackGenerator()
    private lazy var notify = UINotificationFeedbackGenerator()
    private lazy var light = UIImpactFeedbackGenerator(style: .light)
    private lazy var soft = UIImpactFeedbackGenerator(style: .soft)
    private lazy var medium = UIImpactFeedbackGenerator(style: .medium)
    private lazy var heavy = UIImpactFeedbackGenerator(style: .heavy)
    private lazy var rigid = UIImpactFeedbackGenerator(style: .rigid)

    @objc func haptic(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "tap"
        DispatchQueue.main.async {
            switch kind {
            case "select":
                self.selection.selectionChanged(); self.selection.prepare()
            case "soft":
                self.soft.impactOccurred(intensity: 0.6); self.soft.prepare()
            case "press":
                self.medium.impactOccurred(intensity: 0.8); self.medium.prepare()
            case "good":
                self.notify.notificationOccurred(.success); self.notify.prepare()
            case "warn":
                self.notify.notificationOccurred(.warning); self.notify.prepare()
            case "bad":
                self.notify.notificationOccurred(.error); self.notify.prepare()
            case "big":
                self.heavy.impactOccurred()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.09) { self.rigid.impactOccurred(intensity: 0.7) }
            default:
                self.light.impactOccurred(intensity: 0.75); self.light.prepare()
            }
        }
        call.resolve()
    }

    @objc func audioMode(_ call: CAPPluginCall) {
        let mode = call.getString("mode") == "playback" ? "playback" : "ambient"
        DispatchQueue.main.async { VinallAudio.apply(mode) }
        call.resolve(["mode": mode])
    }
}

/// The app's root view controller (Main.storyboard). It exists only to
/// register the plugin above, which is local code rather than an npm package.
class VinallViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VinallNativePlugin())
    }
}
