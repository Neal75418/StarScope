/**
 * Feed 興趣清單設定區塊：興趣 CRUD 與黑名單管理。
 */
import { useState } from "react";
import { useI18n } from "../../i18n";
import { useInterests } from "../../hooks/useInterests";
import type { InterestKind } from "../../api/types";
import { Skeleton } from "../Skeleton";

interface InterestsSectionProps {
  onToast: (message: string, type?: "success" | "error") => void;
}

export function InterestsSection({ onToast }: InterestsSectionProps) {
  const { t } = useI18n();
  const { interests, exclusions, isLoading, create, remove, addExclude, removeExclude } =
    useInterests();
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState<InterestKind>("topic");
  const [weight, setWeight] = useState(2);
  const [excludeTerm, setExcludeTerm] = useState("");

  const handleAdd = async () => {
    const trimmed = term.trim();
    if (!trimmed) return;
    try {
      await create({ term: trimmed, kind, weight });
      setTerm("");
      onToast(t.settings.interests.toast.added, "success");
    } catch {
      onToast(t.settings.interests.toast.error, "error");
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await remove(id);
      onToast(t.settings.interests.toast.removed, "success");
    } catch {
      onToast(t.settings.interests.toast.error, "error");
    }
  };

  const handleAddExclude = () => {
    const trimmed = excludeTerm.trim();
    if (!trimmed) return;
    addExclude(trimmed);
    setExcludeTerm("");
  };

  return (
    <section className="settings-section" data-testid="interests-section">
      <h2>{t.settings.interests.title}</h2>
      <p className="settings-description">{t.settings.interests.subtitle}</p>

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={40} variant="rounded" />
          ))}
        </div>
      ) : (
        <>
          <div className="interest-form-row">
            <input
              data-testid="interest-term-input"
              className="settings-text-input"
              value={term}
              placeholder={t.settings.interests.addPlaceholder}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
            />
            <select
              className="settings-select"
              aria-label={t.settings.interests.kindLabel}
              value={kind}
              onChange={(e) => setKind(e.target.value as InterestKind)}
            >
              <option value="topic">{t.settings.interests.kindTopic}</option>
              <option value="language">{t.settings.interests.kindLanguage}</option>
              <option value="keyword">{t.settings.interests.kindKeyword}</option>
            </select>
            <select
              className="settings-select"
              aria-label={t.settings.interests.weightLabel}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
            <button
              className="btn btn-primary"
              data-testid="interest-add-btn"
              onClick={() => void handleAdd()}
            >
              {t.settings.interests.add}
            </button>
          </div>

          {interests.length === 0 ? (
            <p className="interest-empty">{t.settings.interests.empty}</p>
          ) : (
            <div className="interest-list">
              {interests.map((i) => (
                <div key={i.id} className="interest-item">
                  <div className="interest-item-info">
                    <span className="interest-term">{i.term}</span>
                    <span className="interest-meta">
                      {i.kind} · w{i.weight}
                    </span>
                  </div>
                  <button
                    className="btn btn-sm btn-danger"
                    data-testid={`interest-remove-${i.id}`}
                    aria-label={`${t.settings.interests.remove} ${i.term}`}
                    onClick={() => void handleRemove(i.id)}
                  >
                    {t.settings.interests.remove}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="interest-exclusions">
            <h3>{t.settings.interests.exclusionsTitle}</h3>
            <p className="settings-description">{t.settings.interests.exclusionsSubtitle}</p>

            <div className="interest-form-row">
              <input
                className="settings-text-input"
                value={excludeTerm}
                placeholder={t.settings.interests.addPlaceholder}
                onChange={(e) => setExcludeTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddExclude()}
              />
              <button className="btn" onClick={handleAddExclude}>
                {t.settings.interests.add}
              </button>
            </div>

            {exclusions.length > 0 && (
              <div className="interest-list">
                {exclusions.map((e) => (
                  <div key={e.id} className="interest-item">
                    <div className="interest-item-info">
                      <span className="interest-term">{e.term}</span>
                    </div>
                    <button
                      className="btn btn-sm btn-danger"
                      aria-label={`${t.settings.interests.remove} ${e.term}`}
                      onClick={() => removeExclude(e.id)}
                    >
                      {t.settings.interests.remove}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
