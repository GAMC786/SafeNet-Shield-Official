package com.safenet.dns;

import android.content.Context;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Opaque native surface shown while SafeNet is waiting for authentication.
 */
public final class NativeAppLockView extends FrameLayout {
    private final TextView messageView;
    private final Button unlockButton;
    private final Button settingsButton;

    public NativeAppLockView(Context context) {
        super(context);
        setBackgroundColor(SafeNetLockBrand.BACKGROUND);
        setClickable(true);
        setFocusable(true);

        LinearLayout content = new LinearLayout(context);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        int horizontalPadding = dp(28);
        content.setPadding(horizontalPadding, dp(24), horizontalPadding, dp(24));

        content.addView(SafeNetLockBrand.shieldBadge(context, 72), new LinearLayout.LayoutParams(
                dp(72),
                dp(72)
        ));

        TextView eyebrow = SafeNetLockBrand.eyebrow(context, "SAFENET  /  PROTECTION ACTIVE");
        eyebrow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams eyebrowParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        eyebrowParams.topMargin = dp(18);
        content.addView(eyebrow, eyebrowParams);

        TextView title = new TextView(context);
        title.setText("SafeNet App Lock");
        title.setTextColor(SafeNetLockBrand.TEXT);
        title.setTextSize(24);
        title.setTypeface(SafeNetLockBrand.displayTypeface(), Typeface.BOLD);
        title.setLetterSpacing(0.02f);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        titleParams.topMargin = dp(6);
        content.addView(title, titleParams);

        messageView = new TextView(context);
        messageView.setText(
                "Offline protection for SafeNet. Your passcode and recovery answer " +
                "stay on this device."
        );
        messageView.setTextColor(SafeNetLockBrand.BODY);
        messageView.setTextSize(14);
        messageView.setTypeface(SafeNetLockBrand.bodyTypeface());
        messageView.setLineSpacing(0, 1.08f);
        messageView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        messageParams.topMargin = dp(10);
        content.addView(messageView, messageParams);

        unlockButton = new Button(context);
        unlockButton.setText("Enter passcode");
        unlockButton.setContentDescription("Enter your LockLock passcode to open SafeNet");
        SafeNetLockBrand.stylePrimaryButton(unlockButton, context);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(48)
        );
        buttonParams.topMargin = dp(24);
        content.addView(unlockButton, buttonParams);

        settingsButton = new Button(context);
        settingsButton.setText("Open LockLock setup");
        settingsButton.setContentDescription("Open LockLock setup and Android permission settings");
        SafeNetLockBrand.styleSecondaryButton(settingsButton, context);
        LinearLayout.LayoutParams settingsParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(44)
        );
        settingsParams.topMargin = dp(4);
        content.addView(settingsButton, settingsParams);

        addView(content, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
        ));
    }

    public void setMessage(String message) {
        messageView.setText(message);
    }

    public void setOnUnlockClickListener(OnClickListener listener) {
        unlockButton.setOnClickListener(listener);
    }

    public void setOnSecuritySettingsClickListener(OnClickListener listener) {
        settingsButton.setOnClickListener(listener);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}