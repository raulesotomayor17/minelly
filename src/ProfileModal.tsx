import { useRef, useState } from "react";
import { initialsFor, saveProfile, type UserProfile } from "./profile";
import AvatarCropper from "./AvatarCropper";

export default function ProfileModal({ profile, onClose, onSave }: { profile: UserProfile; onClose: () => void; onSave: (profile: UserProfile) => void }) {
  const [name, setName] = useState(profile.name);
  const [photo, setPhoto] = useState(profile.photo);
  const [cropSource, setCropSource] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function pickPhoto(file: File) {
    const reader = new FileReader();
    reader.onload = () => setCropSource(String(reader.result));
    reader.readAsDataURL(file);
  }

  function submit() {
    const next = { name: name.trim(), photo };
    saveProfile(next);
    onSave(next);
    onClose();
  }

  if (cropSource) {
    return (
      <div className="profile-backdrop" role="dialog" aria-modal="true" aria-label="Ajustar fotografía de perfil">
        <section className="profile-modal avatar-crop-modal">
          <AvatarCropper source={cropSource} onCancel={() => setCropSource("")} onApply={(dataUrl) => { setPhoto(dataUrl); setCropSource(""); }} />
        </section>
      </div>
    );
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
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) pickPhoto(file); event.currentTarget.value = ""; }} />
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
