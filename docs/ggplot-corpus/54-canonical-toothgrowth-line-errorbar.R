# Written for these tests: the ToothGrowth summary read from a file, one line with points
# per supplement and +/- SD error bars, a fixed y axis, the legend below the plot.
library(ggplot2)
tg <- read.csv("toothgrowth_summary.csv")   # columns: supp, dose, len, sd
tg$dose <- factor(tg$dose)

ggplot(tg, aes(x = dose, y = len, colour = supp, group = supp)) +
  geom_line(position = position_dodge(0.1)) +
  geom_point(size = 2.5, position = position_dodge(0.1)) +
  geom_errorbar(aes(ymin = len - sd, ymax = len + sd), width = 0.15, position = position_dodge(0.1)) +
  scale_color_manual(values = c("#CC79A7", "#0072B2")) +
  scale_y_continuous(limits = c(0, 35), breaks = seq(0, 35, 5)) +
  labs(title = "Mean odontoblast length", x = "Vitamin C (mg/day)", y = "Length") +
  theme_minimal() +
  theme(legend.position = "bottom", text = element_text(size = 13))
