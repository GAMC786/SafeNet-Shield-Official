package com.safenet.dns;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.view.View;
import android.view.animation.DecelerateInterpolator;

import java.io.InputStream;

/**
 * Error-only fallback for devices where the Capacitor WebView never paints.
 * It is hidden during normal startup and is not a loading screen.
 */
public final class NativeStartupFallbackView extends View {
    private final Paint backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bodyPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint accentPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint artworkPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Path triangle = new Path();
    private final Bitmap artwork;
    private final ValueAnimator dotAnimator;
    private float dotPulse;

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
        artwork = loadArtwork(context);
        dotAnimator = ValueAnimator.ofFloat(0f, 1f);
        dotAnimator.setDuration(1200L);
        dotAnimator.setRepeatCount(ValueAnimator.INFINITE);
        dotAnimator.setInterpolator(new DecelerateInterpolator());
        dotAnimator.addUpdateListener(animation -> {
            dotPulse = (float) animation.getAnimatedValue();
            invalidate();
        });
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawColor(backgroundPaint.getColor());

        float centerX = getWidth() / 2f;
        float maxWidth = Math.min(getWidth() * 0.78f, 390f);
        float maxHeight = Math.min(getHeight() * 0.78f, 820f);
        float artworkWidth = maxWidth;
        float artworkHeight = artwork == null
                ? 0f
                : artwork.getHeight() * Math.min(maxWidth / artwork.getWidth(), maxHeight / artwork.getHeight());
        if (artwork != null) {
            artworkWidth = artwork.getWidth() * (artworkHeight / artwork.getHeight());
            float left = centerX - artworkWidth / 2f;
            float top = getHeight() / 2f - artworkHeight / 2f;
            canvas.drawBitmap(
                    artwork,
                    null,
                    new RectF(left, top, left + artworkWidth, top + artworkHeight),
                    artworkPaint
            );
        }

        drawTriangularDots(canvas, centerX, getHeight() / 2f);

        accentPaint.setTextSize(13f);
        accentPaint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("Tap anywhere to retry", centerX, getHeight() - 44f, accentPaint);
    }

    private void drawTriangularDots(Canvas canvas, float centerX, float centerY) {
        float lift = 6f * (float) Math.sin(dotPulse * Math.PI);
        int alpha = 120 + (int) (115f * Math.sin(dotPulse * Math.PI));
        accentPaint.setColor(Color.argb(alpha, 96, 165, 250));
        accentPaint.setShadowLayer(12f, 0f, 0f, Color.argb(alpha, 96, 165, 250));
        drawTriangle(canvas, centerX, centerY - 24f - lift);
        drawTriangle(canvas, centerX - 22f, centerY + 14f - lift);
        drawTriangle(canvas, centerX + 22f, centerY + 14f - lift);
        accentPaint.clearShadowLayer();
    }

    private void drawTriangle(Canvas canvas, float centerX, float centerY) {
        triangle.reset();
        triangle.moveTo(centerX, centerY - 9f);
        triangle.lineTo(centerX - 9f, centerY + 7f);
        triangle.lineTo(centerX + 9f, centerY + 7f);
        triangle.close();
        canvas.drawPath(triangle, accentPaint);
    }

    private Bitmap loadArtwork(Context context) {
        try (InputStream stream = context.getAssets().open("public/safenet-astronaut-loader.png")) {
            return BitmapFactory.decodeStream(stream);
        } catch (Exception ignored) {
            return null;
        }
    }

    @Override
    protected void onVisibilityChanged(View changedView, int visibility) {
        super.onVisibilityChanged(changedView, visibility);
        if (changedView != this) {
            return;
        }
        if (visibility == VISIBLE) {
            dotAnimator.start();
        } else {
            dotAnimator.cancel();
        }
    }

    @Override
    protected void onDetachedFromWindow() {
        dotAnimator.cancel();
        super.onDetachedFromWindow();
    }
}