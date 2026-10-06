# ggplot2 reference: geom_smooth — linear fit, no band
ggplot(mpg, aes(displ, hwy)) +
  geom_point() +
  geom_smooth(method = lm, se = FALSE)
