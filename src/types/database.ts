/**
 * Types générés à partir du schéma Supabase.
 *
 * Régénération recommandée dès qu'on modifie une migration :
 *   npm run gen-types
 *
 * (équivalent à `supabase gen types typescript --project-id $SUPABASE_PROJECT_ID
 * --schema public > src/types/database.ts` — voir scripts du package.json).
 *
 * Vague T — fichier mis à jour à la main pour couvrir TOUTES les migrations
 * (0001 → 0018) en attendant que le user branche la CLI Supabase. Toute
 * nouvelle colonne / table doit être reflétée ici (sinon `as any` revient).
 *
 * Pour les UPDATE/INSERT de champs JSONB typés métier (TvDouzeCoupsState,
 * FaceAFaceState, etc.), utiliser le helper `asJsonb()` de
 * `@/lib/supabase/jsonb` plutôt qu'un `as any` éparpillé.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type QuestionType =
  | "quizz_2"
  | "quizz_4"
  | "etoile"
  | "face_a_face"
  | "coup_maitre"
  | "coup_par_coup";

/** Sous-format optionnel pour quizz_2 (Coup d'Envoi). */
export type QuestionFormat = "vrai_faux" | "ou" | "plus_moins" | "choix_2";

export type UserRole = "user" | "admin";

export type GameMode =
  | "jeu1"
  | "coup_par_coup"
  | "etoile"
  | "face_a_face"
  | "coup_maitre"
  | "parcours"
  | "revision"
  | "douze_coups";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          pseudo: string;
          role: UserRole;
          xp: number;
          niveau: number;
          created_at: string;
          avatar_url: string | null;
          theme: "light" | "dark" | "system";
          settings: Json;
          /** K4 — Branding conditionnel Mahylan vs générique. */
          is_owner: boolean;
          /** E4.1 — Raccourcis clavier perso `{ context: { actionId: key } }`. */
          keyboard_shortcuts: Json;
          /** E4.2 — Préférences notifications mail/push. */
          notification_settings: Json;
        };
        Insert: {
          id: string;
          pseudo: string;
          role?: UserRole;
          xp?: number;
          niveau?: number;
          created_at?: string;
          avatar_url?: string | null;
          theme?: "light" | "dark" | "system";
          settings?: Json;
          is_owner?: boolean;
          keyboard_shortcuts?: Json;
          notification_settings?: Json;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      user_favorites: {
        Row: {
          user_id: string;
          question_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          question_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_favorites"]["Insert"]>;
        Relationships: [];
      };
      custom_avatars: {
        Row: {
          id: string;
          url: string;
          tags: string[];
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          url: string;
          tags?: string[];
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["custom_avatars"]["Insert"]>;
        Relationships: [];
      };
      daily_challenges: {
        Row: {
          date: string;
          question_ids: string[];
          created_at: string;
        };
        Insert: {
          date: string;
          question_ids: string[];
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["daily_challenges"]["Insert"]>;
        Relationships: [];
      };
      daily_challenge_results: {
        Row: {
          user_id: string;
          date: string;
          correct_count: number;
          total_count: number;
          answers: Json;
          completed_at: string;
        };
        Insert: {
          user_id: string;
          date: string;
          correct_count: number;
          total_count: number;
          answers?: Json;
          completed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["daily_challenge_results"]["Insert"]>;
        Relationships: [];
      };
      saved_players: {
        Row: {
          id: string;
          owner_id: string;
          pseudo: string;
          avatar_url: string | null;
          games_played: number;
          games_won: number;
          last_played_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          pseudo: string;
          avatar_url?: string | null;
          games_played?: number;
          games_won?: number;
          last_played_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["saved_players"]["Insert"]>;
        Relationships: [];
      };
      tv_rooms: {
        Row: {
          id: string;
          code: string;
          host_id: string;
          status: "waiting" | "playing" | "paused" | "ended";
          game_mode: string;
          mode: "scan" | "remote";
          state: Json;
          face_a_face_state: Json | null;
          created_at: string;
          ended_at: string | null;
          /** Vague T — Compteur monotone pour optimistic locking. */
          state_version: number;
        };
        Insert: {
          id?: string;
          code: string;
          host_id: string;
          status?: "waiting" | "playing" | "paused" | "ended";
          game_mode: string;
          mode?: "scan" | "remote";
          state?: Json;
          face_a_face_state?: Json | null;
          created_at?: string;
          ended_at?: string | null;
          state_version?: number;
        };
        Update: Partial<Database["public"]["Tables"]["tv_rooms"]["Insert"]>;
        Relationships: [];
      };
      tv_room_players: {
        Row: {
          id: string;
          room_id: string;
          player_token: string;
          pseudo: string;
          avatar_url: string | null;
          position: number | null;
          is_connected: boolean;
          is_remote: boolean;
          last_seen_at: string;
          joined_at: string;
          /** Vague S3 — true si bot IA piloté côté serveur/TV. */
          is_bot: boolean;
          /** Vague S3 — taux de réussite cible 0..100 (default 70). */
          bot_skill: number;
        };
        Insert: {
          id?: string;
          room_id: string;
          player_token: string;
          pseudo: string;
          avatar_url?: string | null;
          position?: number | null;
          is_connected?: boolean;
          is_remote?: boolean;
          last_seen_at?: string;
          joined_at?: string;
          is_bot?: boolean;
          bot_skill?: number;
        };
        Update: Partial<Database["public"]["Tables"]["tv_room_players"]["Insert"]>;
        Relationships: [];
      };
      categories: {
        Row: {
          id: number;
          nom: string;
          slug: string;
          emoji: string | null;
          couleur: string | null;
        };
        Insert: {
          id?: number;
          nom: string;
          slug: string;
          emoji?: string | null;
          couleur?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      subcategories: {
        Row: {
          id: number;
          category_id: number | null;
          nom: string;
          slug: string;
        };
        Insert: {
          id?: number;
          category_id?: number | null;
          nom: string;
          slug: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["subcategories"]["Insert"]
        >;
        Relationships: [];
      };
      questions: {
        Row: {
          id: string;
          type: QuestionType;
          category_id: number | null;
          subcategory_id: number | null;
          difficulte: number;
          enonce: string;
          reponses: Json;
          bonne_reponse: string | null;
          alias: Json | null;
          indices: Json | null;
          image_url: string | null;
          explication: string | null;
          author_id: string | null;
          created_at: string;
          format: QuestionFormat | null;
        };
        Insert: {
          id?: string;
          type: QuestionType;
          category_id?: number | null;
          subcategory_id?: number | null;
          difficulte?: number;
          enonce: string;
          reponses: Json;
          bonne_reponse?: string | null;
          alias?: Json | null;
          indices?: Json | null;
          image_url?: string | null;
          explication?: string | null;
          author_id?: string | null;
          created_at?: string;
          format?: QuestionFormat | null;
        };
        Update: Partial<Database["public"]["Tables"]["questions"]["Insert"]>;
        Relationships: [];
      };
      game_sessions: {
        Row: {
          id: string;
          user_id: string | null;
          mode: GameMode;
          score: number;
          correct_count: number;
          total_count: number;
          duration_seconds: number | null;
          xp_gained: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          mode: GameMode;
          score?: number;
          correct_count?: number;
          total_count?: number;
          duration_seconds?: number | null;
          xp_gained?: number;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["game_sessions"]["Insert"]
        >;
        Relationships: [];
      };
      answers_log: {
        Row: {
          id: number;
          session_id: string | null;
          user_id: string | null;
          question_id: string | null;
          is_correct: boolean;
          time_taken_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          session_id?: string | null;
          user_id?: string | null;
          question_id?: string | null;
          is_correct: boolean;
          time_taken_ms?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["answers_log"]["Insert"]>;
        Relationships: [];
      };
      wrong_answers: {
        Row: {
          id: number;
          user_id: string | null;
          question_id: string | null;
          fail_count: number;
          success_streak: number;
          last_seen_at: string;
        };
        Insert: {
          id?: number;
          user_id?: string | null;
          question_id?: string | null;
          fail_count?: number;
          success_streak?: number;
          last_seen_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["wrong_answers"]["Insert"]
        >;
        Relationships: [];
      };
      badges: {
        Row: {
          id: number;
          code: string;
          nom: string;
          description: string | null;
          icone: string | null;
        };
        Insert: {
          id?: number;
          code: string;
          nom: string;
          description?: string | null;
          icone?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["badges"]["Insert"]>;
        Relationships: [];
      };
      user_badges: {
        Row: {
          user_id: string;
          badge_id: number;
          obtained_at: string;
        };
        Insert: {
          user_id: string;
          badge_id: number;
          obtained_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_badges"]["Insert"]>;
        Relationships: [];
      };
      periodic_elements: {
        Row: {
          numero_atomique: number;
          symbole: string;
          nom: string;
          periode: number;
          groupe: number | null;
          row_grid: number;
          col_grid: number;
          famille: string;
          masse_atomique: number | null;
          phase_standard: string | null;
          decouverte_annee: number | null;
          decouverte_par: string | null;
          configuration_electronique: string | null;
          electronegativite: number | null;
          rayon_atomique: number | null;
          temperature_fusion: number | null;
          temperature_ebullition: number | null;
          densite: number | null;
          anecdote: string | null;
        };
        Insert: {
          numero_atomique: number;
          symbole: string;
          nom: string;
          periode: number;
          groupe?: number | null;
          row_grid: number;
          col_grid: number;
          famille: string;
          masse_atomique?: number | null;
          phase_standard?: string | null;
          decouverte_annee?: number | null;
          decouverte_par?: string | null;
          configuration_electronique?: string | null;
          electronegativite?: number | null;
          rayon_atomique?: number | null;
          temperature_fusion?: number | null;
          temperature_ebullition?: number | null;
          densite?: number | null;
          anecdote?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["periodic_elements"]["Insert"]
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
