# LockLock source notice

SafeNet's Secure App Lock by LockLock API includes an adaptation of the
LockLock app-lock behavior and permission boundary from:

<https://github.com/nethical6/LockLock>

The adapted LockLock portions are licensed under the GNU General Public
License, version 3.0 (GPL-3.0). The upstream license text is available at
<https://github.com/nethical6/LockLock/blob/main/LICENSE>.

The SafeNet adaptation keeps the passcode and recovery data offline, adds
salted local hashing, and limits foreground protection to SafeNet unless a
future explicit app-selection flow is added. Distribution of this Android
derivative must preserve the applicable GPL-3.0 notices and corresponding
source obligations.