"""
Telegram message formatters.
"""

from __future__ import annotations


def format_attendance(event_name: str, grouped: dict[str, list[str]]) -> str:
    if not grouped:
        return f"Liste de presences - *{event_name}*\n\n_Aucun participant pour l'instant._"

    total = sum(len(participants) for participants in grouped.values())
    lines = [
        f"Liste de presences - *{event_name}*\n",
        f"*Total : {total}*\n",
    ]
    for category, participants in sorted(grouped.items()):
        lines.append(f"*{category}* ({len(participants)})")
        for index, name in enumerate(participants, start=1):
            lines.append(f"{index}. {name}")
        lines.append("")
    return "\n".join(lines).strip()


def format_add_success(
    event_name: str,
    category: str,
    added: list[str],
    skipped: list[str] | None = None,
) -> str:
    lines = [
        "Participants ajoutes\n",
        f"*Evenement :* {event_name}",
        f"*Categorie :* {category}\n",
        "*Participants :*",
    ]
    lines.extend([f"  - {name}" for name in added])
    if skipped:
        lines.append("\nDeja inscrits :")
        lines.extend([f"  - {name}" for name in skipped])
    return "\n".join(lines)


def format_all_skipped(event_name: str, participants: list[str]) -> str:
    lines = [f"Tous les participants sont deja inscrits pour *{event_name}* :\n"]
    lines.extend([f"  - {name}" for name in participants])
    return "\n".join(lines)


def format_remove_success(event_name: str, participant_name: str) -> str:
    return f"*{participant_name}* a ete retire de *{event_name}*."


def format_remove_not_found(event_name: str, participant_name: str) -> str:
    return f"*{participant_name}* n'a pas ete trouve dans *{event_name}*."


def format_events(events: list[dict]) -> str:
    if not events:
        return "Evenements\n\n_Aucun evenement trouve._"

    lines = ["Evenements a venir\n"]
    for event in events:
        lines.append(f"*{event.get('event_name', '-') }*  `{event.get('date', '-')}`")
        description = event.get("description", "")
        if description:
            lines.append(f"  _{description}_")
        lines.append("")
    return "\n".join(lines).strip()


def format_categories(categories: list[dict]) -> str:
    if not categories:
        return "Categories\n\n_Aucune categorie trouvee._"

    lines = ["Categories\n"]
    lines.extend([f"  - {category.get('category_name', '-')}" for category in categories])
    return "\n".join(lines)


def format_error(message: str) -> str:
    return f"Erreur: {message}"


def format_help() -> str:
    return (
        "Bot de presences\n\n"
        "Je gere les listes de presences et le suivi des classes dans une base centralisee.\n\n"
        "*Commandes disponibles*\n"
        "  /add `<evenement>` `<Prenom Nom>` `[...]` categorie `<categorie>`\n"
        "  /remove `<evenement>` `<Prenom Nom>` `[...]`\n"
        "  /list `<evenement>`\n"
        "  /events - afficher tous les evenements\n"
        "  /categories - afficher toutes les categories\n\n"
        "*Suivi des classes*\n"
        "  /newlesson - enregistrer une lecon\n"
        "  /classreport `<code_classe>` - rapport d'assiduite d'une classe\n"
        "  /studentreport `<nom>` - suivi d'un etudiant\n"
        "  /absentees `<code_classe>` `[titre_lecon]` - absents par lecon\n\n"
        "  /help - afficher ce message\n"
    )


def format_lesson_recorded(result: dict) -> str:
    present = result.get("present", [])
    absent = result.get("absent", [])
    unknown = result.get("unknown", [])
    unregistered = result.get("unregistered", [])
    total = len(present) + len(absent) + len(unknown)

    lines = [
        "✅ Lecon enregistree avec succes\n",
        f"*{result['lesson_title']}*",
        f"{result['lesson_date']}",
        f"{result['teacher_name']}",
        f"Classe {result['class_code']}",
        f"\n📌 Resume : {len(present)}/{total} present(s)",
    ]

    firestore_enabled = bool(result.get("firestore_enabled", True))
    class_created = bool(result.get("class_created", False))
    replaced_existing = bool(result.get("replaced_existing", False))
    if not firestore_enabled:
        lines.append("\n⚠️ Firestore desactive : classe non enregistree.")
    elif replaced_existing:
        lines.append("\n♻️ Lecon existante mise a jour (remplacement).")
    elif class_created:
        lines.append("\n🆕 Nouvelle classe enregistree sur Firestore.")
    else:
        lines.append("\nℹ️ Classe deja existante sur Firestore.")

    if present:
        lines.append(f"\n✅ Presents ({len(present)}) :")
        lines.extend([f"  - {name}" for name in present])

    if absent:
        lines.append(f"\n❌ Absents ({len(absent)}) :")
        lines.extend([f"  - {name}" for name in absent])

    if unknown:
        lines.append(f"\n❓ Non marques ({len(unknown)}) :")
        lines.extend([f"  - {name}" for name in unknown])

    if unregistered:
        lines.append(f"\n⚠️ Non inscrits ({len(unregistered)}) :")
        lines.extend([f"  - {name}" for name in unregistered])

    return "\n".join(lines)


def format_class_report(cls: dict, lessons: list[dict], students: list[dict], att_lookup: dict) -> str:
    class_code = cls.get("class_code", "")
    teacher_name = cls.get("teacher_name", "")

    if not lessons:
        return (
            f"Rapport - Classe {class_code}\n"
            f"{teacher_name}\n\n"
            "_Aucune lecon enregistree pour l'instant._"
        )

    registered = [student for student in students if str(student.get("is_registered", "")).upper() == "TRUE"]
    lesson_count = len(lessons)

    lines = [
        f"Rapport d'assiduite - Classe {class_code}",
        f"{teacher_name}",
        f"{lesson_count} lecon(s) enregistree(s)\n",
        "*Etudiants inscrits :*",
    ]

    for student in sorted(registered, key=lambda item: item["student_name"]):
        name = student["student_name"]
        present_count = sum(
            1
            for lesson in lessons
            if att_lookup.get((lesson["lesson_id"], name.lower()), "") == "present"
        )
        rate = f"{int(present_count / lesson_count * 100)}%" if lesson_count else "N/A"
        lines.append(f"  - {name} - {present_count}/{lesson_count} ({rate})")

    lines.append("\n*Lecons :*")
    for index, lesson in enumerate(lessons, start=1):
        lines.append(f"  {index}. {lesson['lesson_title']} _{lesson['lesson_date']}_")

    return "\n".join(lines)


def format_student_report(student_name: str, records: list[dict]) -> str:
    if not records:
        return f"Aucune donnee trouvee pour *{student_name}*."

    present_count = sum(1 for record in records if record.get("status") == "present")
    total = len(records)
    rate = f"{int(present_count / total * 100)}%" if total else "N/A"
    lines = [
        f"Rapport etudiant - {student_name}",
        f"Assiduite globale : {present_count}/{total} ({rate})\n",
    ]
    for record in records:
        icon = "PRESENT" if record["status"] == "present" else ("ABSENT" if record["status"] == "absent" else "INCONNU")
        lines.append(f"{icon} {record['lesson_date']} - {record['lesson_title']}  _{record['class_code']}_")
    return "\n".join(lines)


def format_absentees(cls: dict, lessons: list[dict], att_by_lesson: dict[str, list[str]]) -> str:
    class_code = cls.get("class_code", "")
    teacher_name = cls.get("teacher_name", "")

    if not lessons:
        return (
            f"Absences - Classe {class_code}\n"
            f"{teacher_name}\n\n"
            "_Aucune lecon correspondante trouvee._"
        )

    lines = [
        f"Absences - Classe {class_code}",
        f"{teacher_name}\n",
    ]
    for lesson in lessons:
        absentees = att_by_lesson.get(lesson["lesson_id"], [])
        lines.append(f"*{lesson['lesson_title']}* - {lesson['lesson_date']} ({len(absentees)} absent(s))")
        if absentees:
            lines.extend([f"  - {name}" for name in sorted(absentees)])
        else:
            lines.append("  _Aucun absent_")
        lines.append("")
    return "\n".join(lines).strip()
