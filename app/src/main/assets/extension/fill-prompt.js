// MAIN world helper: ใส่ Prompt ลง Slate.js editor
// ไฟล์นี้ inject ผ่าน chrome.scripting.executeScript({files:...}) — ทำงานใน MAIN world
// Content script ฝาก prompt text ไว้ใน DOM element #__fill_prompt_data ก่อน inject
// Content script ต้องคลิก editor ให้ active ก่อน inject ไฟล์นี้
(function() {
  // อ่าน prompt จาก DOM element ที่ content script เตรียมไว้
  var holder = document.getElementById('__fill_prompt_data');
  if (!holder) return 'no_holder';
  var promptText = holder.getAttribute('data-prompt');
  holder.remove();

  if (!promptText) return 'no_prompt';

  // หา Slate editor
  var editor = document.querySelector('div[role="textbox"][data-slate-editor="true"]');
  if (!editor) return 'no_editor';

  editor.focus();

  // วิธี A: ClipboardEvent paste — Slate มี onPaste handler ที่อ่าน clipboardData ได้
  try {
    document.execCommand('selectAll', false, null);
    var dt = new DataTransfer();
    dt.setData('text/plain', promptText);
    editor.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    }));
    // Slate paste handler จะ update internal state + re-render DOM
    var text1 = (editor.textContent || '').trim();
    if (text1.length > 0 && text1 !== 'What do you want to create?') {
      return 'ok_paste';
    }
  } catch(e) {}

  // วิธี B: หา Slate instance ผ่าน React fiber แล้วใช้ Transforms API
  try {
    var fiberKey = Object.keys(editor).find(function(k) { return k.startsWith('__reactFiber$'); });
    if (fiberKey) {
      var fiber = editor[fiberKey];
      var current = fiber;
      var maxDepth = 40;
      while (current && maxDepth-- > 0) {
        var props = current.memoizedProps;
        // หา editor object ที่มี insertText (Slate Editor interface)
        if (props && props.editor && typeof props.editor.insertText === 'function') {
          var slateEd = props.editor;
          // ใช้ Slate Transforms: select all → delete → insert
          try {
            // Select all nodes
            if (slateEd.children && slateEd.children.length > 0) {
              var Transforms = null;
              var Editor = null;
              // หา Transforms/Editor จาก module scope (ถ้ามี)
              // ลอง direct API ก่อน
              if (typeof slateEd.select === 'function') {
                slateEd.select({
                  anchor: { path: [0, 0], offset: 0 },
                  focus: { path: [slateEd.children.length - 1, 0], offset: (slateEd.children[slateEd.children.length - 1].children[0].text || '').length }
                });
              }
              if (typeof slateEd.deleteFragment === 'function') {
                slateEd.deleteFragment();
              }
            }
            slateEd.insertText(promptText);
            return 'ok_slate_api';
          } catch(e2) {
            // fallthrough
          }
        }
        // หา onChange callback
        if (props && typeof props.onChange === 'function' && props.editor) {
          // ลองเรียก insertText แล้ว onChange จะ trigger
          try {
            props.editor.insertText(promptText);
            return 'ok_slate_onChange';
          } catch(e3) {}
        }
        current = current.return;
      }
    }
  } catch(e) {}

  // วิธี C: InputEvent beforeinput with insertFromPaste type
  try {
    editor.focus();
    document.execCommand('selectAll', false, null);
    var dt2 = new DataTransfer();
    dt2.setData('text/plain', promptText);
    editor.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertFromPaste',
      data: null,
      dataTransfer: dt2,
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    var text3 = (editor.textContent || '').trim();
    if (text3.length > 0 && text3 !== 'What do you want to create?') {
      return 'ok_inputEvent_paste';
    }
  } catch(e) {}

  // วิธี D: execCommand insertText (last resort — อาจใส่ DOM ได้แต่ Slate ไม่รับ)
  try {
    editor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, promptText);
    return 'ok_execCommand';
  } catch(e) {}

  return 'all_failed';
})();
