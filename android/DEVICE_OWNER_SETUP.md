# SafeNet App Lock: Device Owner setup

Device Owner is an optional Android enrollment mode. It is separate from the
local App Lock passcode and cannot be enabled by a button inside SafeNet.

## Before provisioning

- Back up the device and confirm the local SafeNet passcode and recovery path.
- Android generally requires a fresh, eligible device with no existing Device
  Owner or managed account. Some Android versions require provisioning during
  the initial setup flow.
- Install the exact SafeNet build that will own the device. If Android reports
  that the package is test-only, install that build with `adb install -t`.
- Provisioning can make app removal and Android settings harder. Do not enable
  restrictions until you have confirmed that SafeNet's authenticated removal
  flow works on that device.

## Provision SafeNet

1. Connect the device to a computer with Android Debug Bridge (ADB) enabled.
2. Open SafeNet's App Lock settings and copy the displayed Device Owner command.
3. Run that command from the computer. It uses SafeNet's existing application
   identity and Device Admin receiver; no second SafeNet app is installed.
4. Return to the Device Owner settings and refresh the status.

The command has this form:

```sh
adb shell dpm set-device-owner com.safenet.dns/.LockLockDeviceAdminReceiver
```

Android may reject enrollment when the device is already configured, has user
accounts, or is managed by another administrator. Follow the device's Android
provisioning requirements rather than clearing unrelated accounts or policies.

## Use and remove system controls

Device Owner controls are off by default. From **App Lock → Settings → Device
Owner and system controls**, enable only the restrictions you need. Some
restrictions affect all apps or can interfere with Private DNS, VPN setup,
calls, SMS, credentials, app installation, Safe Mode, or recovery.

On individual launchable apps, SafeNet also exposes **Suspend app** and **Hide
app**. SafeNet itself and Android system apps are excluded. The Device Owner
settings provide a restore action for apps SafeNet suspended or hid.

To leave Device Owner mode, use **Restore SafeNet policies and remove Device
Owner** in the same settings screen. SafeNet first restores only the package
states and restrictions it recorded as its own, clears its anti-uninstall
setting, then asks Android to remove SafeNet as Device Owner. Changes applied
outside SafeNet are not intentionally cleared.