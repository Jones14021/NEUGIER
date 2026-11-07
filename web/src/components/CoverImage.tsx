import { useRef, useState } from 'react';
import { ImagePlus, Images, Trash, X } from 'lucide-react';
import type { Day } from '@neugier/shared';
import { uploadPhotos } from '../api';
import { useTrip } from '../store';

/** Titelbild des Tages: Upload vom Gerät oder Auswahl aus den Erinnerungen. */
export function CoverImage({ day }: { day: Day }) {
  const { state, canEdit, apply, toast } = useTrip();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);

  const set = (cover: string | undefined) => apply([{ op: 'update', type: 'day', id: day.id, patch: { cover } }], cover ? 'Titelbild gesetzt' : 'Titelbild entfernt');

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const [url] = await uploadPhotos([files[0]]);
      set(url);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Fotos dieses Tages zuerst, dann alle anderen
  const photos = [
    ...state.memories.filter((m) => m.dayId === day.id).flatMap((m) => m.photos),
    ...state.memories.filter((m) => m.dayId !== day.id).flatMap((m) => m.photos),
  ];

  if (!day.cover && !canEdit) return null;

  return (
    <div className={`cover${day.cover ? '' : ' empty'}`}>
      {day.cover && <img src={day.cover} alt="" />}
      {canEdit && (
        <div className="cover-actions">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files)} />
          <button className="chip" disabled={busy} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={15} /> {busy ? 'Lädt …' : day.cover ? 'Ändern' : 'Titelbild'}
          </button>
          {photos.length > 0 && (
            <button className="chip" onClick={() => setPicker(true)}>
              <Images size={15} /> Aus Erinnerungen
            </button>
          )}
          {day.cover && (
            <button className="chip" onClick={() => set(undefined)} title="Entfernen">
              <Trash size={15} />
            </button>
          )}
        </div>
      )}
      {picker && (
        <div className="modal-bg" onClick={() => setPicker(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Titelbild aus Erinnerungen</h3>
              <button className="icon-btn" onClick={() => setPicker(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="photo-grid">
              {photos.map((p) => (
                <img
                  key={p}
                  src={p}
                  alt=""
                  loading="lazy"
                  className="pickable"
                  onClick={() => {
                    set(p);
                    setPicker(false);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
