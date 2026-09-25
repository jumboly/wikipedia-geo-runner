import { useState } from 'react'
import { deleteRunner, resetMemory, saveRunner, uid, type RunnerProfile } from '../storage/db'
import { PERSONALITY_PRESETS } from './presets'

interface Props {
  runners: RunnerProfile[]
  onChange: () => void
}

export function RunnersView({ runners, onChange }: Props) {
  const [editing, setEditing] = useState<RunnerProfile | null>(null)

  const blank = (): RunnerProfile => ({ id: uid(), name: '', icon: '🏃', kind: 'jev', personality: '', createdAt: Date.now() })

  const duplicate = async (r: RunnerProfile) => {
    // 現時点では Memory 未実装のため「Personality 同一 / Memory なし」の複製のみ
    await saveRunner({ ...r, id: uid(), name: `${r.name} (複製)`, createdAt: Date.now() })
    onChange()
  }

  return (
    <div className="page">
      <div className="row between">
        <h2>Runners</h2>
        <button className="primary" onClick={() => setEditing(blank())}>
          ＋ 新規 Runner
        </button>
      </div>
      <div className="cards">
        {runners.map((r) => (
          <div key={r.id} className="card">
            <div className="row between">
              <div className="runner-name">
                <span className="icon">{r.icon}</span> {r.name} <span className="tag">{r.kind === 'human' ? 'Human' : 'JEV'}</span>
              </div>
            </div>
            {r.kind === 'jev' && <p className="small muted">{r.personality || '（Personality 未設定）'}</p>}
            <div className="row wrap">
              <button onClick={() => setEditing(r)}>編集</button>
              <button onClick={() => duplicate(r)}>複製</button>
              <button
                onClick={async () => {
                  if (confirm(`${r.name} の Memory をリセットしますか？（Runner とレース履歴は残ります）`)) {
                    await resetMemory(r.id)
                    onChange()
                  }
                }}
              >
                Memory リセット
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (confirm(`${r.name} を削除しますか？（レース履歴は残ります）`)) {
                    await deleteRunner(r.id)
                    onChange()
                  }
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <RunnerEditor
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={async (r) => {
            await saveRunner(r)
            setEditing(null)
            onChange()
          }}
        />
      )}
    </div>
  )
}

function RunnerEditor({ value, onSave, onCancel }: { value: RunnerProfile; onSave: (r: RunnerProfile) => void; onCancel: () => void }) {
  const [r, setR] = useState(value)
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Runner 編集</h3>
        <label>
          名前
          <input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} maxLength={30} />
        </label>
        <label>
          アイコン（絵文字）
          <input value={r.icon} onChange={(e) => setR({ ...r, icon: e.target.value })} maxLength={4} />
        </label>
        <label>
          種別
          <select value={r.kind} onChange={(e) => setR({ ...r, kind: e.target.value as RunnerProfile['kind'] })}>
            <option value="jev">JEV</option>
            <option value="human">Human</option>
          </select>
        </label>
        {r.kind === 'jev' && (
          <>
            <label>
              プリセットから入力
              <select value="" onChange={(e) => setR({ ...r, personality: PERSONALITY_PRESETS.find((p) => p.id === e.target.value)?.text ?? r.personality })}>
                <option value="">— 選択すると Personality 文を上書き —</option>
                {PERSONALITY_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Personality（自由記述）
              <textarea rows={5} value={r.personality} onChange={(e) => setR({ ...r, personality: e.target.value })} maxLength={1000} />
            </label>
          </>
        )}
        <div className="row end">
          <button onClick={onCancel}>キャンセル</button>
          <button className="primary" disabled={!r.name.trim()} onClick={() => onSave({ ...r, name: r.name.trim() })}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
