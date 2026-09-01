// ============================================
// Lightweight RTF Parser (RTF → HTML)
// Minimal implementation for basic RTF documents
// ============================================

(function() {
  'use strict';

  window.parseRTF = function(rtf) {
    if (!rtf || typeof rtf !== 'string') return '';

    // Remove RTF header
    rtf = rtf.replace(/^{\rtf\d*\s*/, '');

    // Track state
    var bold = false;
    var italic = false;
    var underline = false;
    var strikethrough = false;
    var fontSize = 12;
    var fontTable = {};
    var colorTable = {};
    var currentFont = 0;
    var currentColor = null;
    var result = '';
    var i = 0;

    function pushTag(open) {
      if (open) {
        if (bold) result += '<strong>';
        if (italic) result += '<em>';
        if (underline) result += '<u>';
        if (strikethrough) result += '<del>';
      } else {
        if (strikethrough) result += '</del>';
        if (underline) result += '</u>';
        if (italic) result += '</em>';
        if (bold) result += '</strong>';
      }
    }

    function closeTags() {
      pushTag(false);
      bold = false;
      italic = false;
      underline = false;
      strikethrough = false;
    }

    function flushText() {
      if (result.length > 0 && result[result.length - 1] !== '>' && result[result.length - 1] !== '<') {
        // Just continue building
      }
    }

    while (i < rtf.length) {
      var ch = rtf[i];

      if (ch === '\\') {
        i++;
        var cmd = '';
        
        // Read control word or symbol
        if (rtf[i] === '\\') {
          result += '\\';
          i++;
          continue;
        }
        
        while (i < rtf.length && /[a-zA-Z-]/.test(rtf[i])) {
          cmd += rtf[i];
          i++;
        }

        // Check for numeric argument
        var arg = null;
        if (i < rtf.length && rtf[i] === '-') {
          i++;
          arg = '';
          while (i < rtf.length && /[0-9]/.test(rtf[i])) {
            arg += rtf[i];
            i++;
          }
          arg = parseInt(arg, 10);
        } else if (i < rtf.length && /[0-9]/.test(rtf[i])) {
          arg = '';
          while (i < rtf.length && /[0-9]/.test(rtf[i])) {
            arg += rtf[i];
            i++;
          }
          arg = parseInt(arg, 10);
        }

        // Skip space after control word with argument
        if (arg !== null && i < rtf.length && rtf[i] === ' ') {
          i++;
        }

        // Process control word
        switch (cmd) {
          case 'b':
            closeTags();
            if (arg === 0) {
              bold = false;
            } else {
              pushTag(true);
              bold = true;
            }
            break;
          case 'i':
            closeTags();
            if (arg === 0) {
              italic = false;
            } else {
              pushTag(true);
              italic = true;
            }
            break;
          case 'ul':
          case 'ulnone':
            closeTags();
            if (cmd === 'ulnone' || arg === 0) {
              underline = false;
            } else {
              pushTag(true);
              underline = true;
            }
            break;
          case 'strike':
          case 'strikethru':
            closeTags();
            if (arg === 0) {
              strikethrough = false;
            } else {
              pushTag(true);
              strikethrough = true;
            }
            break;
          case 'fs':
            fontSize = arg ? arg / 2 : 24;
            break;
          case 'f':
            currentFont = arg || 0;
            break;
          case 'cf':
            currentColor = arg || 0;
            break;
          case 'par':
          case 'qc':
          case 'ql':
          case 'qr':
          case 'qj':
            closeTags();
            result += '<br>';
            break;
          case 'row':
            result += '</tr><tr>';
            break;
          case 'pard':
            closeTags();
            break;
          case 'plain':
            closeTags();
            bold = false;
            italic = false;
            underline = false;
            break;
          case 'upr':
          case 'dnp':
            // Superscript/subscript placeholders
            result += '<sup>';
            break;
          case 'subs':
            result += '<sub>';
            break;
          case 'lin':
          case 'deff':
            // Ignore
            break;
          default:
            // Unknown control word — skip
            break;
        }

        // Skip group handling for now (basic support)
      } else if (ch === '{') {
        i++;
      } else if (ch === '}') {
        i++;
      } else if (ch === '\n' || ch === '\r') {
        result += '<br>';
        i++;
      } else {
        // Regular text — escape HTML
        var txt = '';
        while (i < rtf.length && rtf[i] !== '\\' && rtf[i] !== '{' && rtf[i] !== '}' && rtf[i] !== '\n' && rtf[i] !== '\r') {
          if (rtf[i] === '&') txt += '&amp;';
          else if (rtf[i] === '<') txt += '&lt;';
          else if (rtf[i] === '>') txt += '&gt;';
          else txt += rtf[i];
          i++;
        }
        result += txt;
      }
    }

    closeTags();
    return result;
  };

})();