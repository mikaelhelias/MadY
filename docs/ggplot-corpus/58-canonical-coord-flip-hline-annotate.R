# Written for these tests: horizontal bars, a reference line and a text annotation
library(ggplot2)
df <- read.csv("effects.csv")   # columns: term, estimate
ggplot(df, aes(x = reorder(term, estimate), y = estimate)) +
  geom_col(fill = "steelblue") +
  geom_hline(yintercept = 0, linetype = "dashed") +
  annotate("text", x = 2, y = 1.5, label = "n = 42") +
  coord_flip() +
  labs(x = NULL, y = "Effect size") +
  theme_bw()
