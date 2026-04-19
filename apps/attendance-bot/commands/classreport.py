"""
commands/classreport.py – Class attendance reporting commands.

/classreport <code_classe>
    Affiche le tableau d'assiduité de toute la classe : taux par étudiant
    et liste des leçons enregistrées.

/studentreport <prénom nom>
    Affiche l'historique de présence d'un étudiant leçon par leçon.

/absentees <code_classe> [fragment_titre_leçon]
    Liste les absents pour chaque leçon (ou une leçon spécifique si un
    fragment de titre est fourni).
"""

from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import ContextTypes

import attendance_service as svc
from utils.formatters import (
    format_absentees,
    format_class_report,
    format_error,
    format_student_report,
)

logger = logging.getLogger(__name__)


# ── /classreport ──────────────────────────────────────────────────────────────

async def classreport_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    /classreport <code_classe>

    Le code classe est la référence visible dans le bloc d'appel
    (ex : 164-2C, 164-1C).  On accepte aussi un fragment du nom du
    professeur (ex : Fatoumata).
    """
    if not context.args:
        await update.message.reply_text(
            "Usage : /classreport `<code_classe>`\n"
            "Exemple : `/classreport 164-2C`",
            parse_mode="Markdown",
        )
        return

    query = " ".join(context.args).strip()
    try:
        data = svc.get_class_report(query)
    except svc.AttendanceError as exc:
        await update.message.reply_text(format_error(str(exc)), parse_mode="Markdown")
        return
    except Exception:
        logger.exception("Error in /classreport")
        await update.message.reply_text(
            format_error("Erreur lors de la récupération du rapport."),
            parse_mode="Markdown",
        )
        return

    await update.message.reply_text(
        format_class_report(
            data["cls"],
            data["lessons"],
            data["students"],
            data["att_lookup"],
        ),
        parse_mode="Markdown",
    )


# ── /studentreport ────────────────────────────────────────────────────────────

async def studentreport_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    /studentreport <prénom nom>

    Affiche toutes les leçons auxquelles l'étudiant a été marqué,
    avec son statut (présent / absent) et le taux global.
    """
    if not context.args:
        await update.message.reply_text(
            "Usage : /studentreport `<Prénom Nom>`\n"
            "Exemple : `/studentreport Maxime AMANKOU`",
            parse_mode="Markdown",
        )
        return

    student_name = " ".join(context.args).strip()
    try:
        records = svc.get_student_report(student_name)
    except svc.AttendanceError as exc:
        await update.message.reply_text(format_error(str(exc)), parse_mode="Markdown")
        return
    except Exception:
        logger.exception("Error in /studentreport")
        await update.message.reply_text(
            format_error("Erreur lors de la récupération du rapport."),
            parse_mode="Markdown",
        )
        return

    await update.message.reply_text(
        format_student_report(student_name, records),
        parse_mode="Markdown",
    )


# ── /absentees ────────────────────────────────────────────────────────────────

async def absentees_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    /absentees <code_classe> [fragment_titre_leçon]

    Sans fragment : toutes les leçons de la classe.
    Avec fragment : uniquement les leçons dont le titre contient ce texte.

    Exemple : /absentees 164-2C foi
    """
    if not context.args:
        await update.message.reply_text(
            "Usage : /absentees `<code_classe>` `[titre_leçon]`\n"
            "Exemple : `/absentees 164-2C`\n"
            "Exemple : `/absentees 164-2C Introduction`",
            parse_mode="Markdown",
        )
        return

    class_code     = context.args[0].strip()
    lesson_filter  = " ".join(context.args[1:]).strip() if len(context.args) > 1 else ""

    try:
        data = svc.get_absentees(class_code, lesson_filter)
    except svc.AttendanceError as exc:
        await update.message.reply_text(format_error(str(exc)), parse_mode="Markdown")
        return
    except Exception:
        logger.exception("Error in /absentees")
        await update.message.reply_text(
            format_error("Erreur lors de la récupération des absences."),
            parse_mode="Markdown",
        )
        return

    await update.message.reply_text(
        format_absentees(data["cls"], data["lessons"], data["att_by_lesson"]),
        parse_mode="Markdown",
    )
