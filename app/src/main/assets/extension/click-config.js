// MAIN world helper: click Config dropdown (aspect ratio / model config button)
// ไฟล์นี้ inject ผ่าน chrome.scripting.executeScript({files:...}) — ไม่โดน obfuscate
// Image mode: 🍌 Nano Banana Pro + crop_9_16 + x1
// Video mode: Video + crop_16_9 + x1
(function() {
  function triggerOpen(btn) {
    // วิธี A: เรียก React onPointerDown handler โดยตรง (ข้าม DOM event — ไม่ต้องพึ่ง isTrusted)
    var propsKey = Object.keys(btn).find(function(k) { return k.startsWith('__reactProps$'); });
    if (propsKey && btn[propsKey] && typeof btn[propsKey].onPointerDown === 'function') {
      var fakeEvent = { button: 0, ctrlKey: false, preventDefault: function() {}, defaultPrevented: false };
      btn[propsKey].onPointerDown(fakeEvent);
      var opened = btn.getAttribute('aria-expanded') === 'true' || btn.getAttribute('data-state') === 'open';
      if (opened) return;
    }

    // วิธี B: เรียก React onKeyDown handler โดยตรง (Enter key)
    if (propsKey && btn[propsKey] && typeof btn[propsKey].onKeyDown === 'function') {
      var fakeKeyEvent = { key: 'Enter', code: 'Enter', preventDefault: function() {}, defaultPrevented: false };
      btn[propsKey].onKeyDown(fakeKeyEvent);
      var opened = btn.getAttribute('aria-expanded') === 'true' || btn.getAttribute('data-state') === 'open';
      if (opened) return;
    }

    // วิธี C: เรียก React onClick handler โดยตรง
    if (propsKey && btn[propsKey] && typeof btn[propsKey].onClick === 'function') {
      btn[propsKey].onClick({ button: 0, preventDefault: function() {}, stopPropagation: function() {} });
      var opened = btn.getAttribute('aria-expanded') === 'true' || btn.getAttribute('data-state') === 'open';
      if (opened) return;
    }

    // วิธี D: หา React fiber แล้วไล่ขึ้น parent หา onOpenToggle / onOpenChange
    var fiberKey = Object.keys(btn).find(function(k) { return k.startsWith('__reactFiber$'); });
    if (fiberKey) {
      var fiber = btn[fiberKey];
      var current = fiber;
      var maxDepth = 30;
      while (current && maxDepth-- > 0) {
        var props = current.memoizedProps;
        if (props) {
          if (typeof props.onOpenToggle === 'function') {
            props.onOpenToggle();
            return;
          }
          if (typeof props.onOpenChange === 'function') {
            props.onOpenChange(true);
            return;
          }
        }
        current = current.return;
      }
    }

    // วิธี E: Fallback
    btn.focus();
    btn.click();
  }

  var btns = document.querySelectorAll('button[aria-haspopup="menu"]');

  // วิธี 1: หา button ที่มี aspect ratio icon (crop_9_16 หรือ crop_16_9) — เจาะจงที่สุด
  for (var i = 0; i < btns.length; i++) {
    var icon = btns[i].querySelector('i.google-symbols');
    var t = icon ? icon.textContent.trim() : '';
    if (t === 'crop_9_16' || t === 'crop_16_9') {
      triggerOpen(btns[i]);
      return true;
    }
  }

  // วิธี 2: หา sibling ของ Create button (arrow_forward)
  var icons = document.querySelectorAll('i.google-symbols');
  for (var j = 0; j < icons.length; j++) {
    if (icons[j].textContent.trim() === 'arrow_forward') {
      var createBtn = icons[j].closest('button');
      if (createBtn && createBtn.previousElementSibling) {
        var prev = createBtn.previousElementSibling;
        if (prev.getAttribute('aria-haspopup') === 'menu') {
          triggerOpen(prev);
          return true;
        }
      }
    }
  }
  return false;
})();
