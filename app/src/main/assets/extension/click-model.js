// MAIN world helper: click Model dropdown (button with arrow_drop_down icon)
// ไฟล์นี้ inject ผ่าน chrome.scripting.executeScript({files:...}) — ไม่โดน obfuscate
(function() {
  function triggerOpen(btn) {
    // เรียก React onPointerDown handler โดยตรง (ข้าม isTrusted check)
    var propsKey = Object.keys(btn).find(function(k) { return k.startsWith('__reactProps$'); });
    if (propsKey && btn[propsKey] && typeof btn[propsKey].onPointerDown === 'function') {
      btn[propsKey].onPointerDown({ button: 0, ctrlKey: false, preventDefault: function() {}, defaultPrevented: false });
      var opened = btn.getAttribute('aria-expanded') === 'true' || btn.getAttribute('data-state') === 'open';
      if (opened) return;
    }
    if (propsKey && btn[propsKey] && typeof btn[propsKey].onKeyDown === 'function') {
      btn[propsKey].onKeyDown({ key: 'Enter', code: 'Enter', preventDefault: function() {}, defaultPrevented: false });
      var opened = btn.getAttribute('aria-expanded') === 'true' || btn.getAttribute('data-state') === 'open';
      if (opened) return;
    }
    if (propsKey && btn[propsKey] && typeof btn[propsKey].onClick === 'function') {
      btn[propsKey].onClick({ button: 0, preventDefault: function() {}, stopPropagation: function() {} });
      var opened = btn.getAttribute('aria-expanded') === 'true' || btn.getAttribute('data-state') === 'open';
      if (opened) return;
    }
    // Fallback: fiber walk
    var fiberKey = Object.keys(btn).find(function(k) { return k.startsWith('__reactFiber$'); });
    if (fiberKey) {
      var current = btn[fiberKey];
      var maxDepth = 30;
      while (current && maxDepth-- > 0) {
        var props = current.memoizedProps;
        if (props) {
          if (typeof props.onOpenToggle === 'function') { props.onOpenToggle(); return; }
          if (typeof props.onOpenChange === 'function') { props.onOpenChange(true); return; }
        }
        current = current.return;
      }
    }
    btn.focus();
    btn.click();
  }

  // หา button[aria-haspopup="menu"] ที่มี icon arrow_drop_down
  var btns = document.querySelectorAll('button[aria-haspopup="menu"]');
  for (var i = 0; i < btns.length; i++) {
    var icon = btns[i].querySelector('i.google-symbols');
    var t = icon ? icon.textContent.trim() : '';
    if (t === 'arrow_drop_down') {
      triggerOpen(btns[i]);
      return true;
    }
  }
  // Fallback: หา button ที่มี text model name
  for (var i = 0; i < btns.length; i++) {
    var text = btns[i].textContent || '';
    if (text.indexOf('Banana') !== -1 || text.indexOf('Imagen') !== -1 || text.indexOf('Veo') !== -1) {
      triggerOpen(btns[i]);
      return true;
    }
  }
  return false;
})();
