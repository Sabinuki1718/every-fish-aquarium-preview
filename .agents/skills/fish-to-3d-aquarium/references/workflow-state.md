# 進行の記録（project.json）

**ユーザーが明示的に依頼した部分修正は、修正とその確認・再修正を主担当だけで行う。確認のためにサブエージェントを作成・再開・呼び出さない。ユーザーがサブエージェントも合わせた確認を明示的に希望した場合だけ、指定された範囲で共同検品する。** 以下の「2体で確認」「全員OKまで反復」は共同検品の場合の規則であり、通常の部分修正には適用しない。初回の魚種調査・画像作成・3Dモデル検品は、開始時にユーザーが選んだ検品体制（共同検品／主担当のみ。希望がなければ主担当のみ）で行う。

工程の状態とユーザーの OK を、作業フォルダの `project.json` に AI が直接書いて残す。専用のツールは使わない。
会話が途切れても、Codex と Claude Code を替えても、このファイルを読めば続きから進められる。

## フォルダ

```
projects/<水槽名>/
  project.json
  species/<id>/
    photos/          ユーザーの写真
    research.md      ①の調査（写真で確認・資料で確認・全ての見えない部位の補完と根拠・生息環境）
    reviews.md       ②③の版ごとのOK/NGと修正履歴（共同検品なら主担当・学術担当・ホビー担当、主担当のみなら主担当）
    views/           ②の三面図（create-fish-3d-views の出力）
    model/           ③の GLB・プレビュー・確認画像（承認版を残す）
  layout/            ④のレイアウト案の画像と配置データ（版ごと）
  aquarium/          ⑤の水槽（HTML・素材画像など）
```

## project.json

```json
{
  "title": "里川の水槽",
  "environment": {
    "ai": "codex",
    "image_generation": "builtin",
    "model_route": "standard",
    "checked_at": "2026-10-23",
    "notes": "Python 3.12 / NumPy・Pillow あり"
  },
  "species": [
    {
      "id": "opsariichthys-platypus",
      "name_ja": "オイカワ",
      "scientific_name": "Opsariichthys platypus",
      "variant": "婚姻色のオス",
      "photos": ["species/opsariichthys-platypus/photos/01.jpg"],
      "stages": {
        "research": { "status": "done" },
        "side_view": { "status": "approved", "version": 1, "approved_at": "2026-10-22", "approval_quote": "側面図OKです", "files": ["species/opsariichthys-platypus/views/images/side-v1.png"] },
        "views": { "status": "approved", "version": 2, "approved_at": "2026-10-23", "approval_quote": "三面図OKです", "files": ["species/opsariichthys-platypus/views/images/side-v1.png", "species/opsariichthys-platypus/views/images/top-v2.png", "species/opsariichthys-platypus/views/images/bottom-v1.png"] },
        "model": { "status": "waiting_approval", "version": 1, "files": ["species/opsariichthys-platypus/model/v1/fish.glb"] }
      }
    }
  ],
  "layout": { "status": "not_started" },
  "aquarium": { "status": "not_started" },
  "history": [
    { "at": "2026-10-23", "stage": "views", "species": "opsariichthys-platypus", "event": "changes_requested", "note": "背鰭の黒斑が無い" },
    { "at": "2026-10-23", "stage": "views", "species": "opsariichthys-platypus", "event": "approved", "quote": "三面図OKです" }
  ]
}
```

- `environment.image_generation`: `builtin`（内蔵）/ `manual`（ユーザーが画像生成サービスで作る）
- `environment.model_route`: `standard`（build-fish-3d-from-views）/ `external`（ユーザーが望んだ外部3Dツール）
- `status`: `not_started` / `in_progress` / `waiting_approval` / `changes_requested` / `approved`（承認のない工程は `done`）

## 承認のルール

- ②側面図（`stages.side_view`）、追加生成した図面セット（`stages.views`）、③3Dモデル（魚種ごと）、④レイアウト案は、採用ファイルと版に対するユーザーの明確なOKがあって初めて `approved` にする。その言葉を `approval_quote` にそのまま書く。
- 側面の承認待ちの間は派生図・3Dを始めない。追加生成が不要な側面素材ルートでは、同じ側面承認を `stages.views` に参照させる。派生図を作るときは、各方向のファイル・版と参照した側面の版・ファイル・SHA-256を記録する。側面を差し替えたら新版を承認待ちに戻し、派生図を再照合してから進む。
- 「最新出力」「検品済み」「ユーザー承認済み」を区別する。生成・納品・技術検査の完了や版番号だけで承認に進めない。一括生成で最新版が v1 のまま、対象ファイルへの明示的な承認がないモデルは未承認とし、検品を通過したものを承認待ちとする。v2 以降も同じ基準で判断し、旧版の承認はその版の履歴として残す。
- 側面図と3Dモデルの承認は別々に記録する。雌雄・色型が複数ある場合は、承認がどの個体、ファイル、版に対するものかを残す。`project.json` から、現行の出力と承認済みの版を工程ごとにたどれるようにする。
- 先へ進む前に、前の工程が `approved` になっているか確かめる。⑤は全魚種の③と④が `approved` であること。
- 修正依頼を受けたら `changes_requested` にし、内容を `history` に残す。直したら版（`version`）を上げて再提示する。
- 前の工程をやり直した場合（例：三面図を直した）は、それを元にした後の工程（その魚の3Dモデル、⑤）も `not_started` に戻し、作り直しが必要なことを伝える。
- 承認版のファイルは上書きしない。版ごとにフォルダかファイル名を分ける。

## 検品体制の記録

開始時にユーザーが選んだ[検品体制](../../create-fish-3d-views/references/species-review.md#検品体制をユーザーが選ぶ)を `project.json` の最上位に残す。各工程の `review.mode` はこれに従う。

```json
"review_policy": { "mode": "main_only", "chosen_at": "2026-11-25", "answer_quote": "主担当のみで", "reason": "ユーザーが選択（希望がない場合は「希望なしのため既定」）" }
```

途中で体制を変えたら `mode` を更新し、変更の言葉を `history` に残す。

## エージェント検品の記録

[共同調査・検品](../../create-fish-3d-views/references/species-review.md) に従い、②③の各工程に `review` を追加する。これはユーザー承認とは別の記録。既存プロジェクトで記録が無い場合は未検品として扱い、次の画像・モデル変更や検品依頼で、選ばれた検品体制で検品する（`review_policy` が無ければユーザーに選んでもらう）。過去のユーザー承認や旧成果物にエージェントのOKを捏造しない。

以下は検品が完了した③をユーザーへ提示している例。詳細は `reviews.md` に追記する。

```json
{
  "status": "waiting_approval",
  "version": 2,
  "files": ["species/<id>/model/v2/fish.glb"],
  "review": {
    "version": 2,
    "status": "passed",
    "record": "species/<id>/reviews.md",
    "verdicts": {
      "main": "OK",
      "academic": "OK",
      "hobby": "OK"
    }
  }
}
```

- `review.status` は `pending`（未判定あり）/ `changes_requested`（NGあり）/ `passed`（全員OK）。各判定は `pending` / `OK` / `NG`。未判定はOKではない。
- `review.version` と工程の `version` が一致し、同じ対象ファイルへ全員がOKを出した場合のみ `passed` にする。NGがあれば工程も `changes_requested`、検品未完了なら `in_progress`。全員OKになって初めて `waiting_approval` にし、その後ユーザーの明確なOKで `approved` にする。
- 画像・モデルを変更したら、工程の版を上げて `review` を `pending`・全員未判定へ戻す。旧版の承認の言葉・日時を新版の現行承認として残さず、履歴へ保存する。過去の判定は `reviews.md` に残す。
- 三面図を直したら、依存するモデルの検品も無効にし、既存の承認ルールに従って後続工程を戻す。
- ツール制限などで保留する場合も検品未完了の状態を保ち、再開条件を `history` と `reviews.md` に残す。

## 部分修正の記録

`review.mode` は `joint`（`review_policy` で共同検品を選んだ場合）または `main_only`（主担当のみを選んだ場合、希望がなく既定とした場合、またはユーザー依頼の部分修正）とする。省略時は `review_policy` に従う。`main_only` では、その新版を主担当が確認してOKを出したら `review.status: passed` / 工程 `waiting_approval` にできる。以下の既存の全員OK条件は `joint` に適用する。サブエージェントの未依頼判定をOK扱いにせず、`verdicts` から省く。旧版の共同判定は履歴へ残す。

```json
{"status":"waiting_approval","version":8,"review":{"version":8,"mode":"main_only","reason":"ユーザーが明示した部分修正。サブ確認の明示希望なし","status":"passed","verdicts":{"main":"OK"}}}
```

ユーザーがサブ確認を明示的に希望した場合は `joint` とし、`reviewers` に今回参加する担当を記録する。その全担当が同じ新版へOKを出すまで修正する。過去のユーザー承認は新版へ移さず、承認待ちを維持する。

## モデル仕様と最新の展示構成

- 承認するモデルの版に[モデル機能一覧](../../build-fish-3d-from-views/references/model-contract.md)を対応させる。元図のファイル・版・ハッシュ、GLBとプレビューのファイル、実装済み／未実装の機能、検品記録を参照する。画像・モデルの修正時には対象の仕様と検品も更新する。
- 側面図、派生した胴体用画像、GLB、回転プレビューの対応を、ファイル名・版・SHA-256で記録する。一覧とプレビューへのリンクはこの記録から作り、更新時にファイルの実在と参照先の版を照合する。旧版を案内する場合は版と承認状態を表示する。
- 最新の魚種・性／成長段階・匹数・表示全長・モデル版・行動設定は共通の構成データにまとめ、UI・読込み・配置・検品で使う。別ファイルの場合は `project.json` から参照する。[記録する内容](../../build-aquarium-from-fish-model/references/behavior-and-learning.md#最新構成と学習情報)を参照する。
- 当初の承認レイアウトは履歴として保持する。後から承認された匹数・サイズ等の変更は最新構成と履歴へ記録し、元の承認画像を書き換えない。未承認の大きな配置変更は既存の再承認ルールに従う。
