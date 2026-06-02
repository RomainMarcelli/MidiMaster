-- Migration 0023 — RPC `random_questions` pour le tirage Révision.
--
-- Problème corrigé : `fetchQuestionsForRevision` faisait `.limit(300)` sans
-- ORDER BY → Postgres renvoyait toujours les 300 mêmes lignes (ordre physique),
-- puis on shufflait côté JS. Avec 250 IDs récents exclus en localStorage, il ne
-- restait qu'une cinquantaine de questions toujours identiques → impression que
-- "ce sont toujours les mêmes" malgré ~2600 questions actives en base.
--
-- Solution : faire `ORDER BY random()` côté Postgres sur le pool COMPLET filtré
-- par catégories/difficultés/types/exclusions, et ne renvoyer que `p_count`
-- lignes. Garantit un vrai tirage uniforme sur l'ensemble du pool éligible.
--
-- Fallback : si après exclusion le pool est plus petit que `p_count`, on
-- élargit en ignorant `p_exclude_ids` (mieux qu'une session vide).
--
-- Sécurité : la fonction est SECURITY INVOKER (par défaut) — elle s'exécute
-- avec les droits du caller, donc les RLS sur `questions` s'appliquent
-- normalement. Toute personne authentifiée peut l'appeler (cf. policy
-- existante "questions readable to all authenticated").

create or replace function public.random_questions(
  p_category_ids int[]   default null,
  p_difficulties int[]   default null,
  p_types        text[]  default null,
  p_count        int     default 50,
  p_exclude_ids  uuid[]  default null
)
returns setof public.questions
language plpgsql
stable
as $$
declare
  v_pool_size int;
  v_min_pool  int := greatest(p_count, 1);
begin
  -- Combien de questions correspondent aux filtres APRÈS exclusion ?
  select count(*) into v_pool_size
  from public.questions q
  where (p_category_ids is null or array_length(p_category_ids, 1) is null
         or q.category_id = any(p_category_ids))
    and (p_difficulties is null or array_length(p_difficulties, 1) is null
         or q.difficulte = any(p_difficulties))
    and (p_types is null or array_length(p_types, 1) is null
         or q.type = any(p_types))
    and (p_exclude_ids is null or array_length(p_exclude_ids, 1) is null
         or not (q.id = any(p_exclude_ids)));

  if v_pool_size >= v_min_pool then
    return query
      select q.*
      from public.questions q
      where (p_category_ids is null or array_length(p_category_ids, 1) is null
             or q.category_id = any(p_category_ids))
        and (p_difficulties is null or array_length(p_difficulties, 1) is null
             or q.difficulte = any(p_difficulties))
        and (p_types is null or array_length(p_types, 1) is null
             or q.type = any(p_types))
        and (p_exclude_ids is null or array_length(p_exclude_ids, 1) is null
             or not (q.id = any(p_exclude_ids)))
      order by random()
      limit p_count;
  else
    -- Pool trop petit après exclusion → on retombe sur le pool complet
    -- (sans `p_exclude_ids`). Garantit qu'on renvoie toujours `p_count`
    -- questions tant que le pool brut le permet.
    return query
      select q.*
      from public.questions q
      where (p_category_ids is null or array_length(p_category_ids, 1) is null
             or q.category_id = any(p_category_ids))
        and (p_difficulties is null or array_length(p_difficulties, 1) is null
             or q.difficulte = any(p_difficulties))
        and (p_types is null or array_length(p_types, 1) is null
             or q.type = any(p_types))
      order by random()
      limit p_count;
  end if;
end;
$$;

comment on function public.random_questions(int[], int[], text[], int, uuid[]) is
  'Tirage aléatoire de questions pour la Révision. ORDER BY random() côté serveur sur le pool filtré (catégories/difficultés/types/exclusions). Fallback sur le pool complet si l''exclusion laisse moins de p_count lignes.';

grant execute on function public.random_questions(int[], int[], text[], int, uuid[])
  to authenticated;
