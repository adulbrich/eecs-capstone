/**
 * Two clicks inside one tick, before React can render the button disabled.
 * Two `fireEvent.click` calls would render between them, as two real clicks
 * do, so the second would land on a disabled button and a test would pass with
 * or without a ref guard behind it.
 *
 * Call it inside an `act` body, or React renders between the two dispatches
 * anyway. Shared by the two bookmark controls' tests, which guard the same
 * write the same way (#846, #885).
 */
export function doubleClickInOneTick(button: HTMLElement) {
  for (const _ of [1, 2]) {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
  }
}
