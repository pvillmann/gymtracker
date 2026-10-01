import { redirect } from "next/navigation";

/**
 * Früher legte man hier eine Übung samt Gerät an. Übungen und Maschinen sind
 * jetzt getrennt; die Kombination entsteht im Training von selbst.
 */
export default function NewExercisePage() {
  redirect("/movements/new");
}
