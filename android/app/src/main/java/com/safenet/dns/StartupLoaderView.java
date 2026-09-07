package com.safenet.dns;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.view.View;
import android.view.animation.DecelerateInterpolator;

import android.animation.ValueAnimator;

public final class StartupLoaderView extends View {
    private final Paint backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dotPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint subtitlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path triangle = new Path();
    private final ValueAnimator pulseAnimator;
    private float pulse = 0.5f;

    public StartupLoaderView(Context context) {
        super(context);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        setContentDescription("Connecting to SafeNet Shield DNS Server+");
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);

        backgroundPaint.setColor(Color.rgb(9, 11, 20));
        linePaint.setColor(Color.argb(90, 239, 68, 68));
        linePaint.setStyle(Paint.Style.STROKE);
        linePaint.setStrokeWidth(2f);
        dotPaint.setColor(Color.rgb(239, 68, 68));
        dotPaint.setShadowLayer(22f, 0f, 0f, Color.argb(240, 239, 68, 68));

        titlePaint.setColor(Color.WHITE);
        titlePaint.setTextAlign(Paint.Align.CENTER);
        titlePaint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        subtitlePaint.setColor(Color.rgb(203, 213, 225));
        subtitlePaint.setTextAlign(Paint.Align.CENTER);
        subtitlePaint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));

        pulseAnimator = ValueAnimator.ofFloat(0f, 1f);
        pulseAnimator.setDuration(1400L);
        pulseAnimator.setRepeatCount(ValueAnimator.INFINITE);
        pulseAnimator.setInterpolator(new DecelerateInterpolator());
        pulseAnimator.addUpdateListener(animation -> {
            pulse = (float) animation.getAnimatedValue();
            invalidate();
        });
        pulseAnimator.start();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawRect(0f, 0f, getWidth(), getHeight(), backgroundPaint);

        float centerX = getWidth() / 2f;
        float centerY = getHeight() / 2f - 74f;
        float triangleSize = Math.min(80f, getWidth() * 0.22f);
        float topY = centerY - triangleSize * 0.55f;
        float bottomY = centerY + triangleSize * 0.55f;
        float leftX = centerX - triangleSize * 0.7f;
        float rightX = centerX + triangleSize * 0.7f;

        triangle.reset();
        triangle.moveTo(centerX, centerY + triangleSize * 0.35f);
        triangle.lineTo(leftX, topY);
        triangle.moveTo(centerX, centerY + triangleSize * 0.35f);
        triangle.lineTo(rightX, topY);
        canvas.drawPath(triangle, linePaint);

        float dotRadius = 8f;
        float pulseScale = 0.82f + (0.18f * (float) Math.sin(pulse * Math.PI));
        dotPaint.setAlpha(115 + (int) (140f * Math.sin(pulse * Math.PI)));
        canvas.drawCircle(centerX, topY - 4f, dotRadius * pulseScale, dotPaint);
        canvas.drawCircle(leftX, bottomY, dotRadius * pulseScale, dotPaint);
        canvas.drawCircle(rightX, bottomY, dotRadius * pulseScale, dotPaint);

        titlePaint.setTextSize(Math.min(24f, getWidth() * 0.06f));
        float titleY = centerY + triangleSize + 48f;
        canvas.drawText("CONNECTING TO", centerX, titleY, titlePaint);
        canvas.drawText("SAFENET SHIELD DNS", centerX, titleY + 32f, titlePaint);
        canvas.drawText("SERVER+", centerX, titleY + 64f, titlePaint);

        subtitlePaint.setTextSize(14f);
        canvas.drawText("Loading secure server settings...", centerX, titleY + 96f, subtitlePaint);
    }

    @Override
    protected void onDetachedFromWindow() {
        pulseAnimator.cancel();
        super.onDetachedFromWindow();
    }
}