const groups = [
  {
    "id": "codex",
    "title": "Codexによる作例"
  },
  {
    "id": "muse",
    "title": "Museによる作例",
    "note": "無料で作れる選択肢。Meta AI の Muse でも、魚種調査から3D水槽まで一通り作れました。"
  }
];

const exhibits = [
  {
    "title": "ハタタテハゼの水槽",
    "image": "hatatate.webp",
    "species": [
      "ハタタテハゼ"
    ],
    "completed": "2026-11-24",
    "model": "Muse",
    "cost": "無料",
    "group": "muse",
    "url": "aquariums/hatatate-haze/"
  },
  {
    "title": "沖縄の海 ― 防波堤の下",
    "image": "okinawa.webp",
    "species": [
      "タカサゴ",
      "オヤビッチャ",
      "ロクセンスズメダイ",
      "オジサン",
      "ハリセンボン",
      "シロダイ",
      "スジアラ",
      "カンモンハタ",
      "ナンヨウブダイ",
      "ハマフエフキ（タマン）"
    ],
    "completed": "2026-11-13",
    "model": "GPT-6.1 Sol",
    "group": "codex",
    "url": "https://okinawa-harbor-aquarium.sabinuki1718.chatgpt.site"
  },
  {
    "title": "モンガラカワハギの水槽",
    "image": "mongara.webp",
    "species": [
      "モンガラカワハギ"
    ],
    "completed": "2026-10-28",
    "model": "GPT-6.1 Sol",
    "group": "codex",
    "url": "https://mongara-calm-aquarium-1718.sabinuki1718.chatgpt.site"
  },
  {
    "title": "ダンゴウオとホンダワラの磯",
    "image": "dangouo.webp",
    "species": [
      "ダンゴウオ"
    ],
    "completed": "2026-10-26",
    "model": "GPT-6.1 Sol",
    "group": "codex",
    "url": "https://dangouo-sargassum-shore.sabinuki1718.chatgpt.site"
  },
  {
    "title": "王道の水景",
    "image": "oudou.webp",
    "species": [
      "カージナルテトラ",
      "エンゼルフィッシュ"
    ],
    "completed": "2026-10-24",
    "model": "GPT-6.1 Sol",
    "group": "codex",
    "url": "https://oudou-aquascape.sabinuki1718.chatgpt.site"
  },
  {
    "title": "6月の琵琶湖湖岸",
    "image": "biwa.webp",
    "species": [
      "ビワヨシノボリ"
    ],
    "completed": "2026-10-23",
    "model": "GPT-6.1 Sol",
    "group": "codex",
    "url": "https://biwa-june-goby-aquarium.sabinuki1718.chatgpt.site"
  },
  {
    "title": "イソギンポの水景",
    "image": "isoginpo.webp",
    "species": [
      "イソギンポ"
    ],
    "completed": "2026-10-22",
    "model": "GPT-6.1 Sol",
    "group": "codex",
    "url": "https://isoginpo-rocky-aquarium.sabinuki1718.chatgpt.site"
  },
  {
    "title": "チョウセンブナの水景",
    "image": "chousenbuna.webp",
    "species": [
      "チョウセンブナ"
    ],
    "completed": "2026-10-22",
    "model": "GPT-6.1 Sol",
    "group": "codex",
    "url": "https://chousenbuna-aquarium-1022.sabinuki1718.chatgpt.site"
  }
];

const search = document.querySelector('#search');
const groupsRoot = document.querySelector('#groups');
const count = document.querySelector('#count');
const empty = document.querySelector('#empty');

function make(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function metadata(label, value) {
  const group = make('div');
  group.append(make('dt', '', label), make('dd', '', value));
  return group;
}

function card(exhibit, index) {
  const article = make('article', 'card');
  const image = make('img', 'photo');
  image.src = 'assets/' + exhibit.image;
  image.alt = exhibit.title + 'の水槽全景';
  image.width = 1040;
  image.height = 650;
  image.loading = index < 3 ? 'eager' : 'lazy';
  image.decoding = 'async';

  const body = make('div', 'card-body');
  const heading = make('h4', '', exhibit.title);
  if (exhibit.cost) heading.append(make('span', 'badge', exhibit.cost));
  const species = make('ul', 'species');
  species.setAttribute('role', 'list');
  species.append(...exhibit.species.map(name => make('li', '', name)));
  const footer = make('div', 'card-footer');
  const details = make('dl', 'meta');
  details.append(metadata('完成日', exhibit.completed), metadata('主要モデル', exhibit.model));
  if (exhibit.cost) details.append(metadata('費用', exhibit.cost));
  const link = make('a', 'open', '3D水槽を開く');
  link.href = exhibit.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', exhibit.title + 'の3D水槽を開く（新しいタブ）');
  const arrow = make('span', '', '↗');
  arrow.setAttribute('aria-hidden', 'true');
  link.append(arrow);

  footer.append(details, link);
  body.append(heading, make('p', 'species-heading', '魚種（' + exhibit.species.length + '種）'), species, footer);
  article.append(image, body);
  return article;
}

const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ja');

function render() {
  const terms = normalize(search.value).trim().split(/\s+/u).filter(Boolean);
  const matches = exhibits.filter(exhibit => {
    const text = normalize([exhibit.title, ...exhibit.species].join(' '));
    return terms.every(term => text.includes(term));
  });
  count.textContent = matches.length === exhibits.length
    ? exhibits.length + '件'
    : matches.length + ' / ' + exhibits.length + '件';
  let index = 0;
  const sections = groups.map(group => {
    const items = matches.filter(exhibit => exhibit.group === group.id);
    if (!items.length) return null;
    const section = make('section', 'group');
    section.setAttribute('aria-labelledby', group.id + '-title');
    const title = make('h3', 'group-title', group.title);
    title.id = group.id + '-title';
    section.append(title);
    if (group.note) section.append(make('p', 'group-note', group.note));
    const grid = make('div', 'gallery');
    grid.append(...items.map(exhibit => card(exhibit, index++)));
    section.append(grid);
    return section;
  }).filter(Boolean);
  groupsRoot.replaceChildren(...sections);
  empty.hidden = matches.length !== 0;
}

search.addEventListener('input', render);
render();
