package com.betterdeepseek.app

import android.graphics.Color
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented tests that verify edge-to-edge rendering is correctly configured in MainActivity.
 *
 * Must run on a connected device or emulator (API 26+). These tests do NOT exercise web content
 * rendering — they assert only that the Activity has configured the window and WebView correctly.
 *
 * Run with: ./gradlew connectedDebugAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class EdgeToEdgeTest {

    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun statusBarColor_isTransparent() {
        activityRule.scenario.onActivity { activity ->
            assertEquals(
                "Status bar must be fully transparent for edge-to-edge",
                Color.TRANSPARENT,
                activity.window.statusBarColor,
            )
        }
    }

    @Test
    fun navigationBarColor_isTransparent() {
        activityRule.scenario.onActivity { activity ->
            assertEquals(
                "Navigation bar must be fully transparent — white strip not allowed",
                Color.TRANSPARENT,
                activity.window.navigationBarColor,
            )
        }
    }

    @Test
    fun window_hasFlagDrawsSystemBarBackgrounds() {
        activityRule.scenario.onActivity { activity ->
            val flags = activity.window.attributes.flags
            assertTrue(
                "FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS required for transparent system bars",
                flags and WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS != 0,
            )
        }
    }

    @Test
    fun decorView_doesNotFitSystemWindows() {
        activityRule.scenario.onActivity { activity ->
            assertFalse(
                "setDecorFitsSystemWindows(false) must be applied for edge-to-edge",
                ViewCompat.getFitsSystemWindows(activity.window.decorView),
            )
        }
    }

    @Test
    fun rootLayout_hasNoTopPadding_soThePageIsFullScreen() {
        activityRule.scenario.onActivity { activity ->
            val rootLayout = activity.window.decorView
                .findViewById<FrameLayout>(android.R.id.content)
                .getChildAt(0) as? FrameLayout
            checkNotNull(rootLayout) { "Root FrameLayout not found as first child of content" }

            // BDS-UI F.8: padding the top edge created a visible blank strip below the status
            // bar. The WebView host must reach the top edge of the window instead.
            assertEquals(
                "Padding top must be 0 so the page flows under the status bar",
                0,
                rootLayout.paddingTop,
            )
        }
    }

    @Test
    fun rootLayout_keepsSideAndBottomInsetsForSystemBarsAndIme() {
        activityRule.scenario.onActivity { activity ->
            val rootLayout = activity.window.decorView
                .findViewById<FrameLayout>(android.R.id.content)
                .getChildAt(0) as? FrameLayout
            checkNotNull(rootLayout) { "Root FrameLayout not found as first child of content" }

            val insets = ViewCompat.getRootWindowInsets(rootLayout)
            checkNotNull(insets) { "Window insets not yet available" }

            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())

            // Bottom handling is deliberately kept so the composer stays above the navigation bar
            // and above the keyboard (adjustResize behaviour).
            assertEquals("Padding left must match the system bar inset", bars.left, rootLayout.paddingLeft)
            assertEquals("Padding right must match the system bar inset", bars.right, rootLayout.paddingRight)
            assertEquals(
                "Padding bottom must match max(system bar, IME) inset",
                maxOf(bars.bottom, ime.bottom),
                rootLayout.paddingBottom,
            )
        }
    }
}
