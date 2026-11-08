package expo.modules.ptthardware

import android.content.Context
import android.graphics.Rect
import android.view.KeyEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher

class TalkToMeKeyboardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TalkToMeKeyboard")
    View(TalkToMeKeyboardView::class) {
      Events("onKeyboardEvent", "onReset")
      Prop("listening") { view: TalkToMeKeyboardView, value: Boolean -> view.listen(value) }
      Prop("capture") { view: TalkToMeKeyboardView, value: Boolean -> view.capture = value }
      Prop("codes") { view: TalkToMeKeyboardView, value: List<String> -> view.codes = value.toSet() }
      Prop("focusRequest") { view: TalkToMeKeyboardView, _: Int -> view.refocus() }
    }
  }
}

class TalkToMeKeyboardView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onKeyboardEvent by EventDispatcher<Map<String, Any>>()
  private val onReset by EventDispatcher<Map<String, Any>>()
  var capture = false
  var codes = emptySet<String>()
  private var listening = false
  private val held = mutableSetOf<String>()

  init {
    isFocusableInTouchMode = true
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  fun listen(value: Boolean) {
    listening = value
    if (value) post { if (listening && isAttachedToWindow) requestFocus() }
    else { reset(); clearFocus() }
  }

  fun refocus() { if (listening) post { if (listening && isAttachedToWindow) requestFocus() } }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (listening) post { if (listening) requestFocus() }
  }

  override fun onDetachedFromWindow() { reset(); super.onDetachedFromWindow() }
  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (!hasWindowFocus) reset() else if (listening) requestFocus()
  }
  override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: Rect?) {
    super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
    if (!gainFocus) reset()
  }

  private fun reset() { held.clear(); onReset(emptyMap<String, Any>()) }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    val code = code(keyCode) ?: return super.onKeyDown(keyCode, event)
    if (!listening || event.isCtrlPressed || event.isAltPressed || event.isMetaPressed || (!capture && !codes.contains(code))) return super.onKeyDown(keyCode, event)
    if (event.repeatCount == 0 && held.add(code)) onKeyboardEvent(mapOf("code" to code, "pressed" to true))
    return true
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    val code = code(keyCode) ?: return super.onKeyUp(keyCode, event)
    if (!held.remove(code)) return super.onKeyUp(keyCode, event)
    onKeyboardEvent(mapOf("code" to code, "pressed" to false))
    return true
  }

  private fun code(key: Int): String? = when (key) {
    in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z -> "Key${('A'.code + key - KeyEvent.KEYCODE_A).toChar()}"
    in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> "Digit${key - KeyEvent.KEYCODE_0}"
    in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> "Numpad${key - KeyEvent.KEYCODE_NUMPAD_0}"
    in KeyEvent.KEYCODE_F1..KeyEvent.KEYCODE_F12 -> "F${key - KeyEvent.KEYCODE_F1 + 1}"
    KeyEvent.KEYCODE_SPACE -> "Space"
    KeyEvent.KEYCODE_ENTER -> "Enter"
    KeyEvent.KEYCODE_ESCAPE -> "Escape"
    KeyEvent.KEYCODE_TAB -> "Tab"
    KeyEvent.KEYCODE_DEL -> "Backspace"
    KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
    KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
    KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
    KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
    KeyEvent.KEYCODE_MINUS -> "Minus"
    KeyEvent.KEYCODE_EQUALS -> "Equal"
    KeyEvent.KEYCODE_LEFT_BRACKET -> "BracketLeft"
    KeyEvent.KEYCODE_RIGHT_BRACKET -> "BracketRight"
    KeyEvent.KEYCODE_BACKSLASH -> "Backslash"
    KeyEvent.KEYCODE_SEMICOLON -> "Semicolon"
    KeyEvent.KEYCODE_APOSTROPHE -> "Quote"
    KeyEvent.KEYCODE_GRAVE -> "Backquote"
    KeyEvent.KEYCODE_COMMA -> "Comma"
    KeyEvent.KEYCODE_PERIOD -> "Period"
    KeyEvent.KEYCODE_SLASH -> "Slash"
    KeyEvent.KEYCODE_NUMPAD_ENTER -> "NumpadEnter"
    KeyEvent.KEYCODE_NUMPAD_ADD -> "NumpadAdd"
    KeyEvent.KEYCODE_NUMPAD_SUBTRACT -> "NumpadSubtract"
    KeyEvent.KEYCODE_NUMPAD_MULTIPLY -> "NumpadMultiply"
    KeyEvent.KEYCODE_NUMPAD_DIVIDE -> "NumpadDivide"
    KeyEvent.KEYCODE_NUMPAD_DOT -> "NumpadDecimal"
    else -> null
  }
}
