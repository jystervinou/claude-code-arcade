#!/usr/bin/env swift
// arcadekeys.swift — global joystick for the arcade arcade (`arcade play global`).
//
// Claude Code owns the keyboard while it has focus, so the TTY joystick
// (`arcade play`) can't steer from that window. This is the smallest honest
// workaround: a listen-only NSEvent global monitor that reacts to exactly
// three keycodes — F1 (left), F2 (right), F3 (boost, and the fire button in
// R-Type) — and writes one letter to ~/.arcade/input for the daemon to poll. Nothing else is read, kept, or
// sent anywhere, and the keystrokes still reach the focused app (a
// listen-only monitor cannot swallow them).
//
// Needs a one-time Accessibility grant for your terminal app (macOS prompts
// on first run; revoke any time in System Settings → Privacy & Security →
// Accessibility — some macOS versions ask under Input Monitoring instead).
// Whether F1 needs fn is a property of the keyboard, not of the layout: a
// PC-style keyboard, or a Mac with "Use F1, F2, etc. keys as standard
// function keys" on, sends keycode 122 for a bare F1. An Apple F-row left on
// its media defaults sends brightness-down (keycode 145) instead, which is
// not a .keyDown event at all and so can never reach this monitor.
import AppKit

let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
guard AXIsProcessTrustedWithOptions(prompt) else {
    print("arcade: grant Accessibility to your terminal app (System Settings → Privacy & Security → Accessibility), then run `arcade play global` again")
    exit(1)
}

// A global monitor is delivered through AppKit's event machinery, so there has
// to be a real NSApplication behind it: under a bare RunLoop.main.run() the
// registration silently no-ops and not one key ever arrives — no error, no
// events, forever. .accessory keeps it out of the Dock and the ⌘-tab switcher.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let input = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".arcade/input")
let keymap: [UInt16: String] = [122: "L", 120: "R", 99: "B"] // F1, F2, F3

NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { ev in
    if let c = keymap[ev.keyCode] {
        try? c.write(to: input, atomically: true, encoding: .utf8)
    }
}
print("global joystick on: F1 ← · F2 → · F3 boost (fire, in R-Type) — steers from any window; ctrl+c stops")
print("(if F1 changes brightness instead, press fn+F1 — your F-row is on its media defaults)")
app.run()
