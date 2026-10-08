# 8. Tailscale and the firewall

After this step, the only way into the laptop is over Tailscale from your own devices, and the laptop can't reach any of them.

**Do this with the laptop nearby.** The firewall part closes SSH on the LAN. If Tailscale isn't working when that happens, you'll need the keyboard to fix it.

## The policy

The laptop joins your tailnet with the tag `tag:momos`. A tagged device belongs to the tag, not to you, so it gets none of your own access. The policy grants your devices SSH and VNC on the laptop, and grants the laptop nothing.

1. Open the [Tailscale admin console](https://login.tailscale.com/admin/acls), Access controls.
2. Merge in `system/tailscale-policy.hujson` from this repo. It has two grants: your devices to `tag:momos` on ports 22, 5900 and 443, and your devices to each other. 443 is for screen sharing in the admin app, below.
3. **Remove the default allow-all grant**, the one with `"src": ["*"], "dst": ["*"]`. Left in, it lets `tag:momos` reach your machines. Never add a grant with `tag:momos` or `*` as the source.
4. Save.

MomOS uses OpenSSH over Tailscale, not Tailscale SSH, so the policy needs no `ssh` section. Tailscale SSH's check mode asks for a browser login from time to time, which would stop agents running unattended.

## The auth key

In the admin console, Settings, Keys, generate an auth key:

- **Tags:** `tag:momos`
- **Reusable:** off
- **Pre-approved:** on, if your tailnet requires device approval

Copy the key. It starts with `tskey-auth-`.

## Join the tailnet

The `tailscale` step reads the key from `MOMOS_TAILSCALE_AUTHKEY` and passes it to `tailscale up` through a file, never on a command line. Run it over your existing LAN connection:

```sh
mom ssh
# now on the laptop, as your admin account:
read -rs MOMOS_TAILSCALE_AUTHKEY && export MOMOS_TAILSCALE_AUTHKEY   # paste the key
sudo --preserve-env=MOMOS_TAILSCALE_AUTHKEY /usr/local/src/momos/system/install.sh tailscale
unset MOMOS_TAILSCALE_AUTHKEY
tailscale ip -4
```

It enables `tailscaled` and runs `tailscale up --advertise-tags=tag:momos --ssh=false` with the laptop's hostname. Screen sharing moves onto the Tailscale address by itself within 30 seconds.

Then, in the admin console's Machines page:

- **Turn off key expiry** for the laptop. Otherwise it drops off the tailnet after six months and you can't reach it until someone at the keyboard logs it back in.
- Check it shows the `tag:momos` tag.

## Switch `mom` to Tailscale

Edit `~/.config/momos/mom.json` on each of your machines and set the device's `host` to its Tailscale name, like `mom-laptop` with MagicDNS on, or its `100.x` address. The new host gets its own SSH connection, and the old LAN one closes by itself after 10 minutes.

```sh
mom ssh true && echo ok over tailscale
```

## Close the LAN

The `firewall` step allows SSH and VNC on `tailscale0` only, then deletes the LAN SSH rule and LocalSend's port 53317. It refuses to run unless `tailscale0` has an address and you're connected over SSH through Tailscale at that moment, so run it from a `mom ssh` session over Tailscale:

```sh
mom ssh
# on the laptop:
sudo /usr/local/src/momos/system/install.sh --dry-run firewall
sudo /usr/local/src/momos/system/install.sh firewall
sudo ufw status numbered
```

Afterwards `ufw` should list 22 and 5900 on `tailscale0` and nothing for SSH from anywhere else.

To put LAN SSH back, for example when Tailscale is broken and you're at the laptop, run `sudo /usr/local/src/momos/system/install.sh firewall-lan`.

## Screen sharing

wayvnc listens on the laptop's Tailscale address, port 5900, with the password from step 7. It never listens on the LAN. Use a viewer with RSA-AES support, such as TigerVNC 1.13 or later:

```sh
mom vnc
```

`mom vnc` opens TigerVNC's `vncviewer`, Remmina or another viewer it finds. macOS Screen Sharing won't connect: it needs Apple's older encryption, which is off because it crashed wayvnc during testing. On a Mac, `mom vnc` only uses TigerVNC, and tells you to run `brew install --cask tigervnc-viewer` if it can't find it.

While you're connected, her screen says "Sam is looking at your screen and can move your mouse". VNC on port 5900 always has control.

## Screen sharing in the admin app

The admin app's Screen page shows her screen in a browser, on your phone too, without TigerVNC. Your phone reaches the laptop over Tailscale, so it needs the Tailscale app, signed in as you, with MagicDNS on (the default).

1. In the admin console, DNS, check that **HTTPS Certificates** is on. The laptop's name then gets a Let's Encrypt certificate, which also puts the name in public certificate logs.
2. Make sure the policy grant includes `tcp:443`.
3. Over Tailscale, set up Tailscale Serve on the laptop:

   ```sh
   mom ssh
   # on the laptop:
   sudo /usr/local/src/momos/system/install.sh web-screen
   tailscale serve status
   ```

   `serve status` should show `https://<laptop>.<your-tailnet>.ts.net` proxying to `http://127.0.0.1:5901`. This is Serve, reachable only on your tailnet. Don't use Funnel, which would put it on the internet.

Nothing answers on that address until you press Start on the Screen page, so `curl https://<laptop>.<your-tailnet>.ts.net/` from your computer gives a 502 until then. [using/admin-app.md](../using/admin-app.md#screen) covers the page. `install.sh web-screen-off` turns it off again.

Next: [disk unlock and autologin](09-startup.md).
