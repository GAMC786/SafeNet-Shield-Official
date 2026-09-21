package com.safenet.dns;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.TextView;

/**
 * Shared visual language for the native SafeNet App Lock surfaces.
 *
 * This intentionally stays local to the Android lock flow so the native
 * protection screen can match the dashboard without changing the web theme.
 */
final class SafeNetLockBrand {
    static final int BACKGROUND = Color.rgb(15, 23, 42);
    static final int SURFACE = Color.rgb(24, 33, 53);
    static final int SURFACE_ALT = Color.rgb(30, 41, 59);
    static final int PRIMARY = Color.rgb(59, 130, 246);
    static final int ACCENT = Color.rgb(56, 189, 248);
    static final int TEXT = Color.rgb(248, 250, 252);
    static final int BODY = Color.rgb(203, 213, 225);
    static final int MUTED = Color.rgb(148, 163, 184);
    static final int BORDER = Color.rgb(51, 65, 85);
    static final int SUCCESS = Color.rgb(52, 211, 153);

    private SafeNetLockBrand() {}

    static GradientDrawable roundedBackground(int fill, int stroke, int radiusDp, Context context) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(fill);
        if (stroke != Color.TRANSPARENT) {
            background.setStroke(dp(context, 1), stroke);
        }
        background.setCornerRadius(dp(context, radiusDp));
        return background;
    }

    static void stylePrimaryButton(Button button, Context context) {
        button.setAllCaps(false);
        button.setTextColor(TEXT);
        button.setTextSize(14);
        button.setTypeface(displayTypeface(), Typeface.BOLD);
        button.setMinHeight(0);
        button.setMinWidth(0);
        button.setPadding(dp(context, 16), 0, dp(context, 16), 0);
        button.setBackground(roundedBackground(PRIMARY, Color.TRANSPARENT, 10, context));
    }

    static void styleSecondaryButton(Button button, Context context) {
        button.setAllCaps(false);
        button.setTextColor(ACCENT);
        button.setTextSize(14);
        button.setTypeface(displayTypeface(), Typeface.BOLD);
        button.setMinHeight(0);
        button.setMinWidth(0);
        button.setPadding(dp(context, 14), 0, dp(context, 14), 0);
        button.setBackground(roundedBackground(Color.TRANSPARENT, BORDER, 10, context));
    }

    static void styleInput(TextView input, Context context) {
        input.setTextColor(TEXT);
        input.setTextSize(16);
        input.setTypeface(bodyTypeface());
        input.setHintTextColor(MUTED);
        input.setBackground(roundedBackground(SURFACE_ALT, BORDER, 10, context));
    }

    static void styleCheckBox(CompoundButton checkBox) {
        checkBox.setTextColor(TEXT);
        checkBox.setTextSize(14);
        checkBox.setTypeface(bodyTypeface());
        checkBox.setButtonTintList(new ColorStateList(
                new int[][] {
                        new int[] { android.R.attr.state_checked },
                        new int[] {}
                },
                new int[] { ACCENT, MUTED }
        ));
    }

    static Typeface displayTypeface() {
        return Typeface.create("sans-serif", Typeface.BOLD);
    }

    static Typeface bodyTypeface() {
        return Typeface.create("sans-serif-condensed", Typeface.NORMAL);
    }

    static Typeface monoTypeface() {
        return Typeface.create("monospace", Typeface.NORMAL);
    }

    static TextView eyebrow(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(ACCENT);
        view.setTextSize(11);
        view.setTypeface(monoTypeface(), Typeface.BOLD);
        view.setLetterSpacing(0.12f);
        return view;
    }

    static ShieldBadge shieldBadge(Context context, int sizeDp) {
        return new ShieldBadge(context, dp(context, sizeDp));
    }

    static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static final class ShieldBadge extends View {
        private final int size;
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint outline = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path shield = new Path();

        ShieldBadge(Context context, int size) {
            super(context);
            this.size = size;
            setContentDescription("SafeNet shield");
            fill.setColor(Color.rgb(30, 64, 175));
            fill.setStyle(Paint.Style.FILL);
            outline.setColor(ACCENT);
            outline.setStyle(Paint.Style.STROKE);
            outline.setStrokeWidth(Math.max(2f, size * 0.035f));
            outline.setStrokeJoin(Paint.Join.ROUND);
        }

        @Override
        protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
            setMeasuredDimension(size, size);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float left = size * 0.18f;
            float right = size * 0.82f;
            float top = size * 0.10f;
            float bottom = size * 0.88f;
            float center = size * 0.50f;
            shield.reset();
            shield.moveTo(center, top);
            shield.lineTo(right, top + size * 0.13f);
            shield.lineTo(right - size * 0.04f, size * 0.53f);
            shield.cubicTo(
                    right - size * 0.08f,
                    size * 0.70f,
                    center + size * 0.13f,
                    size * 0.80f,
                    center,
                    bottom
            );
            shield.cubicTo(
                    center - size * 0.13f,
                    size * 0.80f,
                    left + size * 0.08f,
                    size * 0.70f,
                    left + size * 0.04f,
                    size * 0.53f
            );
            shield.lineTo(left, top + size * 0.13f);
            shield.close();
            canvas.drawPath(shield, fill);
            canvas.drawPath(shield, outline);

            Paint check = new Paint(Paint.ANTI_ALIAS_FLAG);
            check.setColor(TEXT);
            check.setStyle(Paint.Style.STROKE);
            check.setStrokeWidth(Math.max(2f, size * 0.055f));
            check.setStrokeCap(Paint.Cap.ROUND);
            check.setStrokeJoin(Paint.Join.ROUND);
            Path mark = new Path();
            mark.moveTo(size * 0.35f, size * 0.50f);
            mark.lineTo(size * 0.46f, size * 0.61f);
            mark.lineTo(size * 0.67f, size * 0.38f);
            canvas.drawPath(mark, check);
        }
    }
}