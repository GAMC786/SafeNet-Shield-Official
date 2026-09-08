package com.safenet.dns;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.view.View;

/**
 * Dashboard recovery surface for devices where the Capacitor WebView never
 * paints. It stays hidden during normal startup.
 */
public final class NativeStartupFallbackView extends View {
    private final Paint backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bodyPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint accentPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    public NativeStartupFallbackView(Context context) {
        super(context);
        setClickable(true);
        setFocusable(true);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        setContentDescription("SafeNet Command Center. Tap to retry.");

        backgroundPaint.setColor(Color.rgb(9, 11, 20));
        borderPaint.setColor(Color.argb(110, 96, 165, 250));
        borderPaint.setStyle(Paint.Style.STROKE);
        borderPaint.setStrokeWidth(2f);
        titlePaint.setColor(Color.WHITE);
        titlePaint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        bodyPaint.setColor(Color.rgb(148, 163, 184));
        bodyPaint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        accentPaint.setColor(Color.rgb(96, 165, 250));
        accentPaint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawColor(backgroundPaint.getColor());

        float padding = Math.max(24f, getWidth() * 0.08f);
        float centerX = getWidth() / 2f;
        float titleSize = Math.min(30f, Math.max(22f, getWidth() * 0.07f));
        titlePaint.setTextSize(titleSize);
        titlePaint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("COMMAND CENTER", centerX, Math.max(100f, getHeight() * 0.25f), titlePaint);

        bodyPaint.setTextSize(Math.min(16f, Math.max(13f, getWidth() * 0.04f)));
        bodyPaint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText(
                "Protected network status",
                centerX,
                Math.max(132f, getHeight() * 0.25f + 32f),
                bodyPaint
        );

        float cardTop = Math.max(190f, getHeight() * 0.42f);
        if (getWidth() < 520f) {
            float cardWidth = getWidth() - padding * 2f;
            drawCard(
                    canvas,
                    new RectF(padding, cardTop, padding + cardWidth, cardTop + 86f),
                    "NETWORK",
                    "Protected"
            );
            drawCard(
                    canvas,
                    new RectF(padding, cardTop + 100f, padding + cardWidth, cardTop + 186f),
                    "SOUNDTRACK",
                    "Ready"
            );
        } else {
            float cardGap = 12f;
            float cardWidth = (getWidth() - (padding * 2f) - cardGap) / 2f;
            drawCard(
                    canvas,
                    new RectF(padding, cardTop, padding + cardWidth, cardTop + 104f),
                    "NETWORK",
                    "Protected"
            );
            drawCard(
                    canvas,
                    new RectF(padding + cardWidth + cardGap, cardTop, getWidth() - padding, cardTop + 104f),
                    "SOUNDTRACK",
                    "Ready"
            );
        }

        accentPaint.setTextSize(14f);
        accentPaint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("Tap anywhere to retry", centerX, getHeight() - 44f, accentPaint);
    }

    private void drawCard(Canvas canvas, RectF bounds, String label, String value) {
        canvas.drawRoundRect(bounds, 14f, 14f, borderPaint);
        bodyPaint.setTextSize(11f);
        bodyPaint.setTextAlign(Paint.Align.LEFT);
        canvas.drawText(label, bounds.left + 16f, bounds.top + 28f, bodyPaint);
        titlePaint.setTextSize(19f);
        titlePaint.setTextAlign(Paint.Align.LEFT);
        canvas.drawText(value, bounds.left + 16f, bounds.top + 66f, titlePaint);
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
    }
}