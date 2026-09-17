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
        title.setText("SafeNet Shield Locked");
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
        messageView.setText("Authenticate to access your DNS and security controls.");
        messageView.setTextColor(Color.rgb(156, 163, 175));
        messageView.setTextSize(14);
        messageView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        messageParams.topMargin = dp(10);
        content.addView(messageView, messageParams);

        Button unlockButton = new Button(context);
        unlockButton.setText("Unlock SafeNet");
        unlockButton.setTextColor(Color.WHITE);
        unlockButton.setTextSize(14);
        GradientDrawable buttonBackground = new GradientDrawable();
        buttonBackground.setColor(Color.rgb(14, 116, 144));
        buttonBackground.setCornerRadius(dp(8));
        unlockButton.setBackground(buttonBackground);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                dp(48)
        );
        buttonParams.topMargin = dp(24);
        content.addView(unlockButton, buttonParams);

        addView(content, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
        ));
        setTag(unlockButton);
    }

    public void setMessage(String message) {
        messageView.setText(message);
    }

    public void setOnUnlockClickListener(OnClickListener listener) {
        View unlockButton = (View) getTag();
        unlockButton.setOnClickListener(listener);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}