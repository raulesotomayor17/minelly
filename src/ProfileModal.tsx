import { useRef, useState } from "react";
import { initialsFor, saveProfile, type UserProfile } from "./profile";

export default function ProfileModal({ profile, onClose, onSave }: { profile: UserProfile; onClose: () => void; onSave: (profile: UserProfile) => void }) {
  const [name, setName] = useState(profile.name);
  const [photo, setPhoto] = useState(profile.photo);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickPhoto(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = dataUrl;
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    const canvas = document.createElement("canvas");
    const size = 320;
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return setPhoto(dataUrl);
    const side = Math.min(image.width, image.height);
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
    setPhoto(canvas.toDataURL("image/jpeg", 0.86));
  }

  function submit() {
    const next = { name: name.trim(), photo };
    saveProfile(next);
    onSave(next);
    onClose();
  }

  return (
    <div className="profile-backdrop" role="dialog" aria-modal="true" aria-label="Perfil de usuario" onClick={onClose}>
      <section className="profile-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">Identidad local</span><h2>Tu perfil</h2></div>
          <button type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className="profile-photo-row">
          <button type="button" className="profile-avatar large" onClick={() => fileRef.current?.click()} title="Cambiar fotografía">
            {photo ? <img src={photo} alt="Fotografía de perfil" /> : <span>{initialsFor(name)}</span>}
            <small>Cambiar</small>
          </button>
          <div>
            <strong>Fotografía de perfil</strong>
            <p>Se guarda solo en este equipo. No se sube a internet.</p>
            {photo && <button type="button" className="link-button" onClick={() => setPhoto("")}>Quitar fotografía</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void pickPhoto(file); }} />
        </div>
        <label className="profile-name-field">
          <span>Nombre visible</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" maxLength={48} autoFocus />
        </label>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="button" className="primary-button" onClick={submit}>Guardar perfil</button>
        </footer>
      </section>
    </div>
  );
}
