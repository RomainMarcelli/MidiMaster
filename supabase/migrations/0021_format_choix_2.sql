-- Migration 0021 — Ajoute la valeur `choix_2` au champ `questions.format`.
--
-- `choix_2` (générique) : QCM à 2 options sans contrainte de label, utilisé
-- quand les réponses ne sont ni Vrai/Faux ni Plus/Moins ni "L'un ou l'autre"
-- (ex : choix entre 2 entités nommées sans préambule "L'un ou l'autre").
--
-- Stratégie : drop l'ancien check (créé en 0004) et recrée-le avec la
-- nouvelle valeur autorisée.

alter table questions
  drop constraint if exists questions_format_check;

alter table questions
  add constraint questions_format_check
    check (format is null or format in ('vrai_faux', 'ou', 'plus_moins', 'choix_2'));

comment on column questions.format is
  'Sous-format optionnel pour quizz_2 (Coup d''Envoi) : vrai_faux, ou, plus_moins, choix_2.';
