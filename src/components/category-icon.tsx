import {
  Baby,
  Clapperboard,
  FlaskConical,
  Folder,
  Globe,
  Landmark,
  Music,
  Newspaper,
  Sparkles,
  Trophy,
  Tv,
  type LucideProps,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  Baby,
  Clapperboard,
  FlaskConical,
  Folder,
  Globe,
  Landmark,
  Music,
  Newspaper,
  Sparkles,
  Trophy,
  Tv,
};

export function CategoryIcon({
  name,
  ...props
}: { name: string | null | undefined } & Omit<LucideProps, "name">) {
  const Icon = (name && ICONS[name]) || Folder;
  return <Icon {...props} />;
}
