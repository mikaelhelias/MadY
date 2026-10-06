# Written for these tests: boxplot with p-values from the ggpubr extension
library(ggplot2)
library(ggpubr)
df <- read.csv("expression.csv")   # columns: group, expression
ggplot(df, aes(x = group, y = expression, fill = group)) +
  geom_boxplot(width = 0.6, outlier.shape = NA) +
  geom_jitter(width = 0.15, size = 1.2, alpha = 0.6) +
  stat_compare_means(method = "t.test", comparisons = list(c("Control", "Treated"))) +
  scale_fill_brewer(palette = "Set2") +
  coord_cartesian(ylim = c(0, 60)) +
  labs(x = NULL, y = "Expression (a.u.)") +
  theme_classic() +
  theme(legend.position = "none")
