package com.safenet.dns;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
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
        setBackgroundColor(Color.rgb(9, 11, 20));
        setClickable(true);
        setFocusable(true);

        LinearLayout content = new LinearLayout(context);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        int horizontalPadding = dp(28);
        content.setPadding(horizontalPadding, dp(24), horizontalPadding, dp(24));

        TextView mark = new TextView(context);
        mark.setText("◆");
        mark.setTextColor(Color.rgb(56, 189, 248));
        mark.setTextSize(34);
        mark.setGravity(Gravity.CENTER);
        content.addView(mark, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        TextView title = new TextView(context);
        title.setText("Secure App Lock by LockLock API");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        titleParams.topMargin = dp(10);
        content.addView(title, titleParams);

        messageView = new TextView(context);
        messageView.setText(
                "Offline LockLock protection for SafeNet. Your passcode and recovery " +
                "answer stay on this device."
        );
        messageView.setTextColor(Color.rgb(203, 213, 225));
        messageView.setTextSize(14);
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
        unlockButton.setTextColor(Color.WHITE);
        unlockButton.setTextSize(14);
        GradientDrawable buttonBackground = new GradientDrawable();
        buttonBackground.setColor(Color.rgb(2, 132, 199));
        buttonBackground.setCornerRadius(dp(8));
        unlockButton.setBackground(buttonBackground);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                dp(48)
        );
        buttonParams.topMargin = dp(24);
        content.addView(unlockButton, buttonParams);

        settingsButton = new Button(context);
        settingsButton.setText("Open LockLock setup");
        settingsButton.setContentDescription("Open LockLock setup and Android permission settings");
        settingsButton.setTextColor(Color.rgb(125, 211, 252));
        settingsButton.setTextSize(13);
        settingsButton.setBackgroundColor(Color.TRANSPARENT);
        LinearLayout.LayoutParams settingsParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
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