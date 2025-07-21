import { useLocation } from "wouter";
import { ChevronRight, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items?: BreadcrumbItem[];
  className?: string;
}

export default function Breadcrumb({ items = [], className }: BreadcrumbProps) {
  const [, setLocation] = useLocation();
  
  const breadcrumbItems = [
    { label: "Home", href: "/" },
    ...items
  ];

  return (
    <nav className={cn("flex items-center space-x-1 text-sm", className)}>
      {breadcrumbItems.map((item, index) => {
        const isLast = index === breadcrumbItems.length - 1;
        
        return (
          <div key={item.label} className="flex items-center">
            {index === 0 && (
              <Home className="w-4 h-4 text-gray-500 dark:text-gray-400 mr-1" />
            )}
            
            {item.href && !isLast ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation(item.href!)}
                className="h-auto p-0 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 hover:underline font-normal"
              >
                {item.label}
              </Button>
            ) : (
              <span className={cn(
                isLast ? "text-gray-900 dark:text-white font-medium" : "text-gray-500 dark:text-gray-400"
              )}>
                {item.label}
              </span>
            )}
            
            {!isLast && (
              <ChevronRight className="w-4 h-4 text-gray-400 mx-2" />
            )}
          </div>
        );
      })}
    </nav>
  );
}