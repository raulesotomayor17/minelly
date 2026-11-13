export interface UserProfile {
  name: string;
  photo: string;
}

const KEY = "minelly.profile.v1";

export function loadProfile(): UserProfile {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      photo: typeof parsed.photo === "string" ? parsed.photo : "",
    };
  } catch {
    return { name: "", photo: "" };
  }
}

export function saveProfile(profile: UserProfile) {
  localStorage.setItem(KEY, JSON.stringify(profile));
}

export function greetingForHour(hour = new Date().getHours()) {
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

export function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "M";
  return `${parts[0][0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] ?? "" : ""}`.toUpperCase();
}
