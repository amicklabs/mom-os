-- MomOS Hyprland config for @PERSON_NAME@.
--
-- Written by system/install.sh (step "session"). Edit the copy in the MomOS
-- repo and redeploy; changes made here are overwritten.
--
-- This file does not load Omarchy's defaults, so an Omarchy update can't
-- change what she sees. Hyprland 0.56 Lua API: /usr/share/hypr/stubs/hl.meta.lua.

--------------------------------------------------------------------------------
-- Screen

hl.monitor({ output = "", mode = "preferred", position = "auto", scale = 1 })

--------------------------------------------------------------------------------
-- Environment

hl.env("XCURSOR_THEME", "Adwaita")
hl.env("XCURSOR_SIZE", "@CURSOR_SIZE@")
hl.env("HYPRCURSOR_SIZE", "@CURSOR_SIZE@")

hl.env("GDK_BACKEND", "wayland,x11,*")
hl.env("QT_QPA_PLATFORM", "wayland;xcb")
hl.env("ELECTRON_OZONE_PLATFORM_HINT", "wayland")
hl.env("OZONE_PLATFORM", "wayland")
hl.env("XDG_SESSION_TYPE", "wayland")
hl.env("XDG_CURRENT_DESKTOP", "Hyprland")
hl.env("XDG_SESSION_DESKTOP", "Hyprland")

--------------------------------------------------------------------------------
-- Look: no gaps, no borders, no animations, nothing that moves unexpectedly.

hl.config({
  general = {
    gaps_in = 0,
    gaps_out = 0,
    border_size = 0,
    resize_on_border = false,
    allow_tearing = false,
    -- One window at a time, never side by side. Monocle gives every tiled
    -- window the whole area under the bar and shows only the focused one.
    layout = "monocle",
  },

  decoration = {
    rounding = 0,
    shadow = { enabled = false },
    blur = { enabled = false },
  },

  animations = { enabled = false },

  misc = {
    disable_hyprland_logo = true,
    disable_splash_rendering = true,
    force_default_wallpaper = 0,
    background_color = "rgb(1e1e2e)",
    -- A "not responding" dialog would only confuse her. momd watches instead.
    enable_anr_dialog = false,
    focus_on_activate = true,
    key_press_enables_dpms = true,
    mouse_move_enables_dpms = true,
    disable_autoreload = true,
  },

  cursor = {
    hide_on_key_press = false,
    inactive_timeout = 0,
    warp_on_change_workspace = 0,
  },

  binds = {
    workspace_back_and_forth = false,
    allow_workspace_cycles = false,
  },

  xwayland = { force_zero_scaling = true },

  ecosystem = {
    no_update_news = true,
    no_donation_nag = true,
  },
})

--------------------------------------------------------------------------------
-- Input

hl.config({
  input = {
    kb_layout = "us",
    kb_options = "",
    follow_mouse = 1,
    -- A little slower than libinput's default, so a brushed palm moves the
    -- pointer less.
    sensitivity = -0.2,
    numlock_by_default = true,

    -- Her palms brush the trackpad while she types. Tapping is off, so only a
    -- real press clicks. disable_while_typing and libinput's palm detection
    -- only work because /etc/udev/hwdb.d/70-momos-touchpad.hwdb marks the
    -- trackpad internal (install.sh user). See MACHINE-NOTES.
    touchpad = {
      natural_scroll = true,
      tap_to_click = false,
      clickfinger_behavior = true,
      disable_while_typing = true,
      scroll_factor = 0.5,
    },
  },
})

--------------------------------------------------------------------------------
-- Keys
--
-- Nothing but the media keys and the power button. No SUPER shortcuts, no
-- workspace switching, no close-window key.
--
-- The lid switch is deliberately NOT bound. The sensor is broken (see
-- ~@ADMIN_USER@/MACHINE-NOTES.md) and momd handles the lid with averaging.

local key = { locked = true, repeating = true }

hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+"), key)
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-"), key)
hl.bind("XF86AudioMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"), { locked = true })
hl.bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%+"), key)
hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%-"), key)
hl.bind("XF86KbdBrightnessUp", hl.dsp.exec_cmd("brightnessctl --device='*::kbd_backlight' set 10%+"), key)
hl.bind("XF86KbdBrightnessDown", hl.dsp.exec_cmd("brightnessctl --device='*::kbd_backlight' set 10%-"), key)

-- Power button sleeps, then hibernates after an hour (HibernateDelaySec in
-- /etc/systemd/sleep.conf.d/10-hibernate-delay.conf). Same as the admin session.
hl.bind("XF86PowerOff", hl.dsp.exec_cmd("systemctl suspend-then-hibernate"), { locked = true })

--------------------------------------------------------------------------------
-- Workspaces
--
-- "home" stays empty so the MomOS shell's home screen shows. Each tile gets
-- its own workspace named tile-<id>; momctl puts windows there.

hl.workspace_rule({ workspace = "name:home", default = true, persistent = true })
hl.workspace_rule({
  workspace = "n[s:tile-]",
  gaps_in = 0,
  gaps_out = 0,
  no_border = true,
  no_rounding = true,
  no_shadow = true,
  decorate = false,
})

--------------------------------------------------------------------------------
-- Windows
--
-- Every window fills the area under the shell's bar, one at a time: the
-- monocle layout above does that for every tiled window, however many a
-- workspace holds, and the newest or focused one is the one on screen. The bar
-- is a layer surface with an exclusive zone, which monocle respects, so Home
-- and Get help stay visible.
--
-- Nothing is maximized or fullscreen. Apps' own requests for either (YouTube's
-- fullscreen button, F11, a double click on a title bar) are ignored, so a
-- video fills the app window instead of covering the bar. An earlier config
-- maximized every window instead, but Hyprland keeps one maximized window per
-- workspace, so a second window there was tiled beside the first.

hl.window_rule({
  name = "momos-no-fullscreen",
  match = { class = ".*" },
  suppress_event = "fullscreen fullscreenoutput maximize",
})

-- Dialogs Hyprland floats by itself (Save, Print, Open, confirmations) sit in
-- the middle of the screen over the app that asked, never at the edge.
hl.window_rule({
  name = "momos-center-dialogs",
  match = { float = true },
  center = true,
})

-- File pickers from the desktop portal (Chromium's Save as and upload, for
-- example): floating, centered and big, below the bar.
hl.window_rule({
  name = "momos-file-picker",
  match = { class = "^(xdg-desktop-portal-gtk|xdg-desktop-portal-hyprland)$" },
  float = true,
  center = true,
  size = { "(monitor_w*0.85)", "(monitor_h*0.75)" },
})

-- Telegram lives on its tile's workspace and doesn't jump forward on every
-- new message. Incoming calls are brought forward by momd.
hl.window_rule({
  name = "momos-telegram-workspace",
  match = { class = "^(org\\.telegram\\.desktop|telegram-desktop)$" },
  workspace = "name:tile-@TELEGRAM_TILE@ silent",
  focus_on_activate = false,
})

-- Other windows open on the workspace she's looking at, on top. momctl puts
-- a tile's window on its own workspace, and momd moves web app windows that
-- open elsewhere, sends her home when a workspace empties, and keeps home
-- itself empty (apps/momd/src/windows.ts). A plain browser window opened from
-- a link covers what she was looking at, and closing it brings that back.

--------------------------------------------------------------------------------
-- Startup
--
-- The shell, momd, wayvnc, ydotoold and Telegram run as systemd user units
-- under momos-session.target (/etc/systemd/user), so each restarts on its own
-- and logs to the journal. This script exports the Wayland environment to
-- systemd, then starts the target.

hl.on("hyprland.start", function()
  hl.dispatch(hl.dsp.focus({ workspace = "name:home" }))
  hl.exec_cmd("/usr/local/lib/momos/momos-session-start")
end)
