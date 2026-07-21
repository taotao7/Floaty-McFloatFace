/**
 * Suppress the webview's default context menu. WKWebView shows an empty
 * bordered popup on right-click when the app provides no menu of its own,
 * which reads as a stray little outline box over the UI. Imported for side
 * effects by every window entry point.
 */
document.addEventListener("contextmenu", (e) => e.preventDefault());
