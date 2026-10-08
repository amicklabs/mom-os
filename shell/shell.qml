// MomOS shell: home screen, bar, pages, banners, notifications and lock
// screen for the person's session. Run with `qs -c momos` when installed or
// `qs -p <this folder>` in development. See Common/Store.qml, Common/Session.qml,
// Windows/Notifications.qml and Windows/LockScreen.qml for the environment
// variables it reads.

import QtQuick
import Quickshell
import Quickshell.Io
import qs.Common
import "Windows"

ShellRoot {
  id: shell

  Variants {
    model: Quickshell.screens
    HomeScreen {}
  }

  Variants {
    model: Quickshell.screens
    PageWindow {}
  }

  Variants {
    model: Quickshell.screens
    Bar {}
  }

  Variants {
    model: Quickshell.screens
    MorePanel {}
  }

  Variants {
    model: Quickshell.screens
    Banners {}
  }

  // The status button's card: the internet and battery in words.
  Variants {
    model: Quickshell.screens
    StatusPanel {}
  }

  Variants {
    model: Quickshell.screens
    HelpCard {}
  }

  Variants {
    model: Quickshell.screens
    ReminderAlert {}
  }

  // It maps when it turns on, so it sits above the bar and the home screen.
  Variants {
    model: Quickshell.screens
    Screensaver {}
  }

  // "Turning off…" or "Restarting…", over everything, once she confirms.
  Variants {
    model: Quickshell.screens
    PowerScreen {}
  }

  Notifications {}

  VolumeCard {}

  LockScreen {}

  // Development only, for screenshots without a pointer: open the More panel
  // or the Help pop-up, press a row on the Internet connection or Speaker
  // page, or confirm Turn off or Restart.
  // Not part of the contract.
  IpcHandler {
    target: "momos-dev-ui"
    function more(): string { Session.moreOpen = true; return "ok" }
    // The card under the bar's status button.
    function status(): string { Session.statusOpen = true; return "ok" }
    // A tap on the bar's eye, while someone is looking.
    function eye(): string { Session.showViewerNotice(Store.viewerText); return "ok" }
    // The Help pop-up, optionally in a given stage (compose, recording,
    // sending, sent, offline, failed, unreachable) with her words and kinds
    // ("message,call-me"). Nothing is sent.
    function helpCard(): string { Session.openHelp(); return "ok" }
    // Press one of the pop-up's buttons: send, screen, call, voice, stop,
    // cancel or close. Runs momctl, so only use it with the stub.
    function helpPress(what: string): string {
      var words = Session.helpDraft
      if (what === "send") Session.sendHelp({ text: words })
      else if (what === "screen") Session.sendHelp({ text: words, screenshot: true })
      else if (what === "call") Session.sendHelp({ text: words, callMe: true })
      else if (what === "voice") Session.startVoice()
      else if (what === "stop") Session.sendHelp({ text: words, voice: true })
      else if (what === "cancel") Session.cancelVoice()
      else if (what === "close") Session.closeHelp()
      else return "error: unknown button"
      return Session.helpStage
    }
    function helpShow(stage: string, words: string, kinds: string): string {
      Session.helpDraft = words
      Session.helpKinds = kinds === "" ? [] : kinds.split(",")
      Session.helpRecordingSince = Date.now() - 7000
      Session.helpOpen = true
      Session.helpStage = stage
      return "ok"
    }
    // On the Internet connection page: press a network's row, or "" for
    // "My network isn't listed".
    function wifiPick(name: string): string { Wifi.pickRequested(name); return "ok" }
    // On the Speaker page: press a speaker's row, "forget:<name>" or
    // "disconnect:<name>" for its small buttons, or "output:computer" or
    // "output:<name>" for a choice under "Where does the sound come out?".
    function speakerPick(name: string): string { Speaker.pickRequested(name); return "ok" }
    // Press Turn off ("off") or Restart ("restart") on its page. Runs momctl
    // power, so only use it with the stub.
    function powerConfirm(what: string): string { Power.start(what); return "ok" }
  }

  // The contract in docs/contracts.md: momctl and the helper's tools call these.
  IpcHandler {
    target: "shell"

    function lock(): string {
      Session.lock()
      return "ok"
    }

    function unlock(): string {
      Session.unlock()
      return "ok"
    }

    function home(): string {
      Session.showHome()
      return "ok"
    }

    // hypridle calls this (through `momctl screensaver on|off`) after a few
    // idle minutes and again on the next input.
    function screensaver(state: string): string {
      if (state !== "on" && state !== "off") return "error: screensaver takes on or off"
      Session.setScreensaver(state === "on")
      return Session.screensaver ? "on" : "off"
    }

    function page(id: string): string {
      Session.moreOpen = false
      Session.closeHelp()
      Session.page = id
      return "ok"
    }
  }
}
