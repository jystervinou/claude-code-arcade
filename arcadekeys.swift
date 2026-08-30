#!/usr/bin/env swift
// arcadekeys.swift — global joystick for the arcade arcade (`arcade play global`).
//
// Claude Code owns the keyboard while it has focus, so the TTY joystick
// (`arcade play`) can't steer from that window. This is the smallest honest
// workaround: a listen-only NSEvent global monitor that reacts to exactly
// three keycodes — F1 (left), F2 (right), F3 (boost) — and writes one letter
// to ~/.arcade/input for the daemon to poll. Nothing else is read, kept, or
// sent anywhere, and the keystrokes still reach the focused app (a
// listen-only monitor cannot swallow them).
//
// Needs a one-time Accessibility grant for your terminal app (macOS prompts
// on first run; revoke any time in System Settings → Privacy & Security →
// Accessibility — some macOS versions ask under Input Monitoring instead).
// On laptop keyboards press fn+F1/F2/F3, or enable "Use F1, F2, etc. keys
// as standard function keys".
import AppKit

let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
guard AXIsProcessTrustedWithOptions(prompt) else {
    print("arcade: grant Accessibility to your terminal app (System Settings → Privacy & Security → Accessibility), then run `arcade play global` again")
    exit(1)
}

let input = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".arcade/input")
let keymap: [UInt16: String] = [122: "L", 120: "R", 99: "B"] // F1, F2, F3

NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { ev in
    if let c = keymap[ev.keyCode] {
        try? c.write(to: input, atomically: true, encoding: .utf8)
    }
}
print("global joystick on: F1 ← · F2 → · F3 boost — steers from any window; ctrl+c stops")
RunLoop.main.run()
