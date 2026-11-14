// ==========================================
// Gnomie's little cartoon (used by Spell It Out, previewed in Backstage)
// She starts in her bra and panties; each miss she puts one piece back on:
// fishnets, skirt, shirt, boots, sunglasses, jacket.
// Her hair color and length are set in Backstage (default: the long brown wig).
// ==========================================
(function() {
  'use strict';

  var PIECES = ['fishnets', 'skirt', 'shirt', 'boots', 'shades', 'jacket'];
  // each piece's color (kept here so it never depends on a cached stylesheet)
  var FILL = { skirt: '#ff5fa2', shirt: '#f6f1f7', boots: '#ff5fa2', shades: '#1b1117', jacket: '#231d27' };
  var DEFAULT_LOOK = { hair: '#5e3f2d', length: 'long', roots: false, lips: '#e3557f' };
  var HAIR = {
    // back of the hair, and the two front pieces over her shoulders
    long:  { back: 'M50 38 Q46 6 80 5 Q114 6 110 38 Q115 58 111 80 Q119 96 112 116 Q104 108 101 98 L59 98 Q56 108 48 116 Q41 96 49 80 Q45 58 50 38 Z',
             left: 'M60 40 Q53 66 57 90 Q56 106 49 116 Q63 112 64 96 Q66 74 64 50 Z',
             right: 'M100 40 Q107 66 103 90 Q104 106 111 116 Q97 112 96 96 Q94 74 96 50 Z',
             shine: 'M66 20 Q74 15 82 16 M53 52 Q51 70 53 86 M107 52 Q109 70 107 86' },
    medium: { back: 'M50 38 Q46 6 80 5 Q114 6 110 38 Q113 56 110 70 Q116 80 112 88 Q104 84 100 78 L60 78 Q56 84 48 88 Q44 80 50 70 Q47 56 50 38 Z',
             left: 'M60 40 Q54 60 56 74 Q55 82 49 88 Q62 86 63 76 Q65 62 64 50 Z',
             right: 'M100 40 Q106 60 104 74 Q105 82 111 88 Q98 86 97 76 Q95 62 96 50 Z',
             shine: 'M66 20 Q74 15 82 16 M54 50 Q52 62 54 74 M106 50 Q108 62 106 74' },
    short: { back: 'M51 38 Q47 6 80 5 Q113 6 109 38 Q113 56 110 70 Q107 77 100 74 L60 74 Q53 77 50 70 Q47 56 51 38 Z',
             left: 'M60 40 Q54 56 56 68 Q57 76 64 75 Q62 64 64 50 Z',
             right: 'M100 40 Q106 56 104 68 Q103 76 96 75 Q98 64 96 50 Z',
             shine: 'M66 20 Q74 15 82 16 M54 46 Q53 58 55 68 M106 46 Q107 58 105 68' }
  };
  function lighter(hex, t) {
    var n = parseInt(String(hex).replace('#', ''), 16); if (isNaN(n)) return '#8c6249';
    var r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function m(c) { return Math.round(c + (255 - c) * t); }
    return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
  }
  function boot(x) {
    return '<path d="M' + x + ' 194 L' + (x + 19) + ' 194 L' + (x + 20) + ' 224 L' + (x - 2) + ' 224 Z" />' +
      '<rect class="so-sole" x="' + (x - 3) + '" y="223" width="25" height="7" rx="2" />' +
      '<path class="so-lace-line" d="M' + (x + 4) + ' 200 L' + (x + 15) + ' 200 M' + (x + 4) + ' 206 L' + (x + 15) + ' 206 M' + (x + 4) + ' 212 L' + (x + 15) + ' 212" />';
  }

  // misses: how many pieces are back on (0-6). opts: { changed: index just put on, look: {hair, length} }
  function html(misses, opts) {
    opts = opts || {};
    var look = Object.assign({}, DEFAULT_LOOK, opts.look || {});
    var hair = /^#[0-9a-fA-F]{6}$/.test(look.hair) ? look.hair : DEFAULT_LOOK.hair;
    var H = HAIR[look.length] || HAIR.long;
    var hairStyle = ' style="fill:' + hair + '"', shine = lighter(hair, 0.28);
    var lips = /^#[0-9a-fA-F]{6}$/.test(look.lips) ? look.lips : DEFAULT_LOOK.lips;
    function piece(i, svg) {
      if (i >= misses) return '';
      return '<g class="so-piece so-' + PIECES[i] + (i === opts.changed ? ' on' : '') + '"' + (FILL[PIECES[i]] ? ' fill="' + FILL[PIECES[i]] + '"' : '') + '>' + svg + '</g>';
    }
    return '<svg class="so-figure" viewBox="0 0 160 250" aria-label="' + misses + ' of 6 pieces put back on">' +
      '<defs><pattern id="so-net" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
        '<path d="M0 0 L0 5 M0 0 L5 0" stroke="#1b1117" stroke-width="1" /></pattern></defs>' +
      '<path class="so-hair"' + hairStyle + ' d="' + H.back + '" />' +
      // body
      '<g class="so-skin">' +
        '<rect x="74" y="60" width="12" height="16" rx="4" />' +
        '<path d="M58 76 Q80 70 102 76 Q111 98 99 118 Q111 132 110 145 Q106 156 98 160 L62 160 Q54 156 50 145 Q49 132 61 118 Q49 98 58 76 Z" />' +
        '<rect x="44" y="80" width="11" height="60" rx="5" /><rect x="105" y="80" width="11" height="60" rx="5" />' +
        '<rect x="62" y="148" width="17" height="76" rx="7" /><rect x="81" y="148" width="17" height="76" rx="7" />' +
        '<circle cx="80" cy="40" r="21" />' +
      '</g>' +
      // face
      '<g class="so-face">' +
        '<ellipse class="so-iris" cx="72.5" cy="42" rx="2.6" ry="3.1" /><ellipse class="so-iris" cx="87.5" cy="42" rx="2.6" ry="3.1" />' +
        '<circle class="so-glint" cx="73.3" cy="41" r="0.8" /><circle class="so-glint" cx="88.3" cy="41" r="0.8" />' +
        '<path class="so-lash" d="M69 39.5 Q72.5 37.2 76 39.2 M69.5 39.6 L67.6 38.2 M84 39.2 Q87.5 37.2 91 39.5 M90.5 39.6 L92.4 38.2" />' +
      '</g>' +
      '<path class="so-lips" style="fill:' + lips + '" d="M75.5 51 Q80 ' + (misses >= 4 ? '52.6' : '54.4') + ' 84.5 51 Q80 49.4 75.5 51 Z" />' +
      '<g class="so-blush" fill="rgba(255,95,162,0.42)"><circle cx="67" cy="48" r="3.6" /><circle cx="93" cy="48" r="3.6" /></g>'   /* her makeup always stays on */ +
      // fishnet tights go on first and sit under the panties, up to her waist
      piece(0, '<path d="M50 133 Q49 140 50 145 Q54 156 62 160 L62 222 Q62 225 70.5 225 Q79 225 79 222 L79 163 L81 163 L81 222 Q81 225 89.5 225 Q98 225 98 222 L98 160 Q106 156 110 145 Q111 140 110 133 Q80 128 50 133 Z" fill="url(#so-net)" />') +
      // what always stays on: bra and panties
      '<g class="so-bra"><path d="M80 91 Q68 79 57 90 Q53 106 65 111 Q78 113 80 98 Z" /><path d="M80 91 Q92 79 103 90 Q107 106 95 111 Q82 113 80 98 Z" />' +
        '<path class="so-strap" d="M60 87 L61 77 M100 87 L99 77" /></g>' +
      '<path class="so-panties" d="M49.5 133 Q80 128.5 110.5 133 L109.5 141 Q95 145 88 157 Q80 162 72 157 Q65 145 50.5 141 Z" />' +
      // the rest, bottom to top
      piece(1, '<path d="M59.5 119 Q80 116 100.5 119 Q109 128 111.5 141 L114 165 Q80 171 46 165 L48.5 141 Q51 128 59.5 119 Z" />') +
      piece(2, '<path d="M57 75 Q80 69 103 75 Q112.5 98 100.5 118 L101 124 Q80 127.5 59 124 L59.5 118 Q47.5 98 57 75 Z" /><rect x="43" y="77" width="13" height="21" rx="6" /><rect x="104" y="77" width="13" height="21" rx="6" />') +
      piece(3, boot(61) + boot(81)) +
      piece(5, '<path d="M55 72.5 Q63 68.5 72 69.5 L71 129 Q60 130 51.5 127 Q45.5 98 55 72.5 Z" /><path d="M105 72.5 Q97 68.5 88 69.5 L89 129 Q100 130 108.5 127 Q114.5 98 105 72.5 Z" /><rect x="41.5" y="74" width="16" height="65" rx="7" /><rect x="102.5" y="74" width="16" height="65" rx="7" />') +
      // hair in front, then full wispy bangs
      '<path class="so-hair"' + hairStyle + ' d="' + H.left + '" />' +
      '<path class="so-hair"' + hairStyle + ' d="' + H.right + '" />' +
      '<path class="so-hair"' + hairStyle + ' d="M58 37 Q57 14 80 14 Q103 14 102 37 L99 34.5 L96 37.5 L92.5 33.5 L89 37 L85 33 L81.5 36.5 L78 33 L74.5 36.5 L71 33.5 L67.5 37 L64 34 L61 37.5 Z" />' +
      // grown-out dark roots on top (optional)
      (look.roots ? '<path class="so-roots" d="M58 31 Q57 13 80 13 Q103 13 102 31 Q93 22 80 22.5 Q67 22 58 31 Z" />' : '') +
      '<path class="so-shine" style="stroke:' + shine + '" d="' + H.shine + '" />' +
      piece(4, '<path d="M64 38 Q64 34 68 34 L76 34 Q78 34 78 37 Q78 45 71 45 Q64 45 64 38 Z" /><path d="M82 37 Q82 34 84 34 L92 34 Q96 34 96 38 Q96 45 89 45 Q82 45 82 37 Z" /><rect x="77" y="35.5" width="6" height="2" />') +
    '</svg>';
  }

  window.GnomieFigure = { PIECES: PIECES, DEFAULT_LOOK: DEFAULT_LOOK, LENGTHS: ['long', 'medium', 'short'], html: html };
})();
